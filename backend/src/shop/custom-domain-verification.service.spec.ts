import { ConflictException } from '@nestjs/common';
import { CustomDomainVerificationService } from './custom-domain-verification.service';
import type { DatabaseService } from '../database/database.service';
import type { DnsResolver } from './dns-resolver';
import type { SchedulerService } from '../jobs/scheduler.service';
import type { DomainsService } from '../domains/domains.service';

// Typed so `.mock.calls[i][0]` narrows to the SQL string (no `no-unsafe-*`).
type QueryMock = jest.Mock<Promise<unknown[]>, [string, unknown[]?]>;
type ExecuteMock = jest.Mock<
  Promise<{ affectedRows: number }>,
  [string, unknown[]?]
>;
type ResolveTxtMock = jest.Mock<Promise<string[][]>, [string]>;

const firstSql = (m: ExecuteMock): string => m.mock.calls[0][0];
const allSql = (m: ExecuteMock): string[] => m.mock.calls.map((c) => c[0]);

function make(opts: {
  claim?: Record<string, unknown>;
  takenBy?: Array<{ id: number }>;
  txt?: string[][];
  txtThrows?: boolean;
  execAffected?: number;
  execThrows?: unknown;
}) {
  const query: QueryMock = jest.fn<Promise<unknown[]>, [string, unknown[]?]>();
  const execute: ExecuteMock = jest
    .fn<Promise<{ affectedRows: number }>, [string, unknown[]?]>()
    .mockResolvedValue({ affectedRows: opts.execAffected ?? 1 });
  // verifyClaim issues: 1st query = load claim, 2nd = "taken by another shop?"
  query
    .mockResolvedValueOnce(opts.claim ? [opts.claim] : [])
    .mockResolvedValueOnce(opts.takenBy ?? []);
  if (opts.execThrows !== undefined) {
    execute.mockRejectedValueOnce(opts.execThrows);
    execute.mockResolvedValue({ affectedRows: 1 }); // the follow-up "-> failed" write
  }
  const resolveTxt: ResolveTxtMock = opts.txtThrows
    ? jest
        .fn<Promise<string[][]>, [string]>()
        .mockRejectedValue(new Error('ENOTFOUND'))
    : jest
        .fn<Promise<string[][]>, [string]>()
        .mockResolvedValue(opts.txt ?? []);

  const db = { query, execute } as unknown as DatabaseService;
  const dns = { resolveTxt } as unknown as DnsResolver;
  const scheduler = { runLocked: jest.fn() } as unknown as SchedulerService;
  const domains = { invalidate: jest.fn() } as unknown as DomainsService;
  const service = new CustomDomainVerificationService(
    db,
    dns,
    scheduler,
    domains,
  );
  return { service, query, execute, resolveTxt };
}

const PENDING = {
  customDomain: 'shop.example.com',
  customDomainVerifyToken: 'tok-abc',
  customDomainStatus: 'pending',
};

describe('CustomDomainVerificationService.verifyClaim', () => {
  it('returns not-verified when there is no claim', async () => {
    const { service } = make({});
    const r = await service.verifyClaim(1);
    expect(r.status).toBeNull();
    expect(r.verified).toBe(false);
    expect(typeof r.message).toBe('string');
  });

  it('short-circuits when already verified (no DNS lookup)', async () => {
    const { service, resolveTxt } = make({
      claim: { ...PENDING, customDomainStatus: 'verified' },
    });
    expect(await service.verifyClaim(1)).toEqual({
      status: 'verified',
      verified: true,
    });
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it('short-circuits when the claim already failed', async () => {
    const { service } = make({
      claim: { ...PENDING, customDomainStatus: 'failed' },
    });
    const r = await service.verifyClaim(1);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('failed');
  });

  it('409s and terminal-fails the claim when another shop already verified the domain', async () => {
    const { service, execute } = make({
      claim: PENDING,
      takenBy: [{ id: 99 }],
    });
    await expect(service.verifyClaim(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(firstSql(execute)).toContain("customDomainStatus = 'failed'");
  });

  it('moves pending -> verifying and stays unverified when the TXT record is missing', async () => {
    const { service, execute } = make({
      claim: PENDING,
      txt: [['some-other-value']],
    });
    const r = await service.verifyClaim(1);
    expect(r.status).toBe('verifying');
    expect(r.verified).toBe(false);
    expect(typeof r.message).toBe('string');
    expect(firstSql(execute)).toContain("customDomainStatus = 'verifying'");
  });

  it('treats a DNS lookup error as "not there yet", not a hard failure', async () => {
    const { service } = make({ claim: PENDING, txtThrows: true });
    const r = await service.verifyClaim(1);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('verifying');
  });

  it('verifies when a TXT record exactly equals the token (joining split chunks)', async () => {
    const { service, execute } = make({
      claim: PENDING,
      txt: [['tok', '-abc']],
    });
    const r = await service.verifyClaim(1);
    expect(r).toEqual({ status: 'verified', verified: true });
    expect(firstSql(execute)).toContain("customDomainStatus = 'verified'");
  });

  it('does NOT verify on a partial/substring TXT match', async () => {
    const { service } = make({ claim: PENDING, txt: [['tok-abc-and-more']] });
    expect((await service.verifyClaim(1)).verified).toBe(false);
  });

  it('returns retry (not verified) when the CAS flip matches zero rows (token rotated mid-check)', async () => {
    const { service } = make({
      claim: PENDING,
      txt: [['tok-abc']],
      execAffected: 0,
    });
    const r = await service.verifyClaim(1);
    expect(r.verified).toBe(false);
    expect(r.message).toMatch(/changed/i);
  });

  it('409s and fails the claim when the verified-key unique index rejects the flip (cross-shop race)', async () => {
    const dupErr = Object.assign(new Error('dup'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const { service, execute } = make({
      claim: PENDING,
      txt: [['tok-abc']],
      execThrows: dupErr,
    });
    await expect(service.verifyClaim(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      allSql(execute).some((s) => s.includes("customDomainStatus = 'failed'")),
    ).toBe(true);
  });
});

describe('CustomDomainVerificationService.runSweep', () => {
  function sweepService(rows: Array<Record<string, unknown>>) {
    const query: QueryMock = jest
      .fn<Promise<unknown[]>, [string, unknown[]?]>()
      .mockResolvedValue(rows);
    const execute: ExecuteMock = jest
      .fn<Promise<{ affectedRows: number }>, [string, unknown[]?]>()
      .mockResolvedValue({ affectedRows: 1 });
    const resolveTxt: ResolveTxtMock = jest
      .fn<Promise<string[][]>, [string]>()
      .mockResolvedValue([]);
    const db = { query, execute } as unknown as DatabaseService;
    const dns = { resolveTxt } as unknown as DnsResolver;
    const scheduler = { runLocked: jest.fn() } as unknown as SchedulerService;
    const domains = { invalidate: jest.fn() } as unknown as DomainsService;
    const service = new CustomDomainVerificationService(
      db,
      dns,
      scheduler,
      domains,
    );
    const verifySpy = jest
      .spyOn(service, 'verifyClaim')
      .mockResolvedValue({ status: 'verifying', verified: false });
    return { service, execute, verifySpy };
  }

  it('terminal-fails a claim older than 48h without calling verifyClaim', async () => {
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000);
    const { service, execute, verifySpy } = sweepService([
      { id: 5, customDomainClaimedAt: old, customDomainLastCheckedAt: old },
    ]);
    await service.runSweep();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(firstSql(execute)).toContain("customDomainStatus = 'failed'");
  });

  it('rechecks a fresh claim that has never been checked', async () => {
    const { service, verifySpy } = sweepService([
      {
        id: 6,
        customDomainClaimedAt: new Date(),
        customDomainLastCheckedAt: null,
      },
    ]);
    await service.runSweep();
    expect(verifySpy).toHaveBeenCalledWith(6, 'sweep');
  });

  it('skips a claim checked more recently than its backoff tier allows', async () => {
    const { service, verifySpy } = sweepService([
      {
        id: 7,
        customDomainClaimedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min old -> tier 1 (5 min interval)
        customDomainLastCheckedAt: new Date(Date.now() - 60 * 1000), // checked 1 min ago
      },
    ]);
    await service.runSweep();
    expect(verifySpy).not.toHaveBeenCalled();
  });
});
