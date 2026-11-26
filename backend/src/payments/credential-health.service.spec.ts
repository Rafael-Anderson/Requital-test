import {
  CredentialHealthService,
  isCredentialRejection,
} from './credential-health.service';
import { NomodApiError } from './nomod/nomod-client';
import type { DatabaseService } from '../database/database.service';
import type { JobsService } from '../jobs/jobs.service';
import type { OrderNotificationsService } from '../orders/order-notifications.service';

describe('isCredentialRejection', () => {
  it('nomod: 401 and 403 only', () => {
    expect(
      isCredentialRejection('nomod', new NomodApiError('x', 401, false)),
    ).toBe(true);
    expect(
      isCredentialRejection('nomod', new NomodApiError('x', 403, false)),
    ).toBe(true);
    expect(
      isCredentialRejection('nomod', new NomodApiError('x', 400, false)),
    ).toBe(false);
    expect(
      isCredentialRejection('nomod', new NomodApiError('x', 500, true)),
    ).toBe(false);
    expect(
      isCredentialRejection('nomod', new NomodApiError('x', null, true)),
    ).toBe(false);
    expect(isCredentialRejection('nomod', new Error('network'))).toBe(false);
  });

  it('stripe: authentication_error only', () => {
    expect(
      isCredentialRejection('stripe', { type: 'StripeAuthenticationError' }),
    ).toBe(true);
    expect(
      isCredentialRejection('stripe', { rawType: 'authentication_error' }),
    ).toBe(true);
    expect(
      isCredentialRejection('stripe', { type: 'StripeConnectionError' }),
    ).toBe(false);
    expect(isCredentialRejection('stripe', { type: 'StripeCardError' })).toBe(
      false,
    );
    expect(isCredentialRejection('stripe', null)).toBe(false);
  });

  it('other providers never count', () => {
    expect(
      isCredentialRejection('tabby', new NomodApiError('x', 401, false)),
    ).toBe(false);
  });
});

describe('CredentialHealthService', () => {
  function build(affected: number[]) {
    const execute = jest.fn<
      Promise<{ affectedRows: number }>,
      [string, unknown[]]
    >();
    for (const n of affected)
      execute.mockResolvedValueOnce({ affectedRows: n });
    execute.mockResolvedValue({ affectedRows: 0 });
    const query = jest.fn().mockResolvedValue([{ id: 7 }]);
    const enqueue = jest
      .fn<Promise<object>, [number, string, { body: string }, string]>()
      .mockResolvedValue({});
    const resolve = jest.fn().mockResolvedValue('+971501234567');
    const svc = new CredentialHealthService(
      { execute, query } as unknown as DatabaseService,
      { enqueue } as unknown as JobsService,
      {
        resolveMerchantAlertRecipient: resolve,
      } as unknown as OrderNotificationsService,
    );
    return { svc, execute, enqueue };
  }

  it('a rejection marks the row and alerts when the 24h claim wins', async () => {
    // 1st execute = the status UPDATE, 2nd = the alert claim.
    const { svc, execute, enqueue } = build([1, 1]);
    await svc.observe(4, 'nomod', true, {
      ok: false,
      error: new NomodApiError('x', 401, false),
    });
    expect(execute.mock.calls[0][0]).toMatch(/credentialStatus = 'rejected'/);
    expect(execute.mock.calls[0][0]).toMatch(/credentials IS NOT NULL/);
    expect(execute.mock.calls[1][0]).toMatch(/INTERVAL 24 HOUR/);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe(4);
    expect(enqueue.mock.calls[0][1]).toBe('send_merchant_whatsapp_alert');
    expect(enqueue.mock.calls[0][2].body).toMatch(
      /Nomod rejected your API key/,
    );
  });

  it('no alert when the 24h claim loses (already alerted)', async () => {
    const { svc, enqueue } = build([0, 0]);
    await svc.observe(4, 'stripe', true, {
      ok: false,
      error: { type: 'StripeAuthenticationError' },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('the platform fallback key (no own credentials) records nothing', async () => {
    const { svc, execute } = build([]);
    await svc.observe(4, 'stripe', false, {
      ok: false,
      error: { type: 'StripeAuthenticationError' },
    });
    await svc.observe(4, 'stripe', false, { ok: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('a non-credential failure records nothing; a success clears', async () => {
    const { svc, execute } = build([]);
    await svc.observe(4, 'nomod', true, {
      ok: false,
      error: new NomodApiError('x', 503, true),
    });
    expect(execute).not.toHaveBeenCalled();
    await svc.observe(4, 'nomod', true, { ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatch(/SET credentialStatus = NULL/);
    expect(execute.mock.calls[0][1]).toEqual([4, 'nomod']);
  });

  it('never throws when the database fails', async () => {
    const svc = new CredentialHealthService(
      {
        execute: jest.fn().mockRejectedValue(new Error('db down')),
      } as unknown as DatabaseService,
      {} as JobsService,
      {} as OrderNotificationsService,
    );
    await expect(
      svc.observe(1, 'nomod', true, {
        ok: false,
        error: new NomodApiError('x', 401, false),
      }),
    ).resolves.toBeUndefined();
    await expect(
      svc.observe(1, 'nomod', true, { ok: true }),
    ).resolves.toBeUndefined();
  });
});
