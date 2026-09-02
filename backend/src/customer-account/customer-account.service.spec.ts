import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CustomerAccountService } from './customer-account.service';
import type { DatabaseService } from '../database/database.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { PublicService } from '../public/public.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { CustomerContext } from '../customer-auth/customer-context';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const ctx: CustomerContext = { customerId: 1, shopId: 10 };

function baseCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    shopId: 10,
    name: 'Jane Shopper',
    phone: '0501234567',
    email: 'jane@example.com',
    birthday: null,
    addresses: [{ id: 'a1', address: '1 Main St', emirate: 'Dubai' }],
    registeredAt: new Date('2026-01-01'),
    createdAt: new Date('2025-01-01'),
    emailVerified: true,
    lastDataExportAt: null as Date | null,
    ...overrides,
  };
}

function createMockDb(opts: {
  customer?: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  authToken?: Record<string, unknown> | null;
  adminUser?: { id: number } | null;
}) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM customer WHERE id')) {
      return Promise.resolve([opts.customer ?? baseCustomer()]);
    }
    if (sql.includes('FROM `order` o')) {
      return Promise.resolve(opts.orders ?? []);
    }
    if (sql.includes('FROM orderitem WHERE orderId IN')) {
      return Promise.resolve(opts.items ?? []);
    }
    if (sql.includes('FROM invoice WHERE orderId IN')) {
      return Promise.resolve([]);
    }
    if (sql.includes('FROM customerauthtoken WHERE tokenHash')) {
      return Promise.resolve(opts.authToken ? [opts.authToken] : []);
    }
    if (sql.includes('FROM user WHERE shopId')) {
      return Promise.resolve(opts.adminUser === null ? [] : [opts.adminUser ?? { id: 99 }]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const execute = jest.fn().mockResolvedValue({ affectedRows: 1, insertId: 1 });
  return { query, execute } as unknown as DatabaseService & {
    query: jest.Mock;
    execute: jest.Mock;
  };
}

const mockInvoicesService = {} as InvoicesService;
const mockPublicService = {
  getProductsByIds: jest.fn().mockResolvedValue([]),
} as unknown as PublicService;

function createMockAuditLog() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
}

describe('CustomerAccountService.exportData', () => {
  it('returns profile/addresses/orders scoped to (ctx.customerId, ctx.shopId), and stamps lastDataExportAt', async () => {
    const db = createMockDb({
      orders: [
        {
          id: 5,
          status: 'delivered',
          orderType: 'delivery',
          paymentStatus: 'paid',
          paymentMethod: 'cash_on_delivery',
          outletName: 'Main',
          deliveryDate: null,
          deliveryTimeSlot: null,
          customerAddress: '1 Main St',
          deliveryFee: null,
          taxAmount: null,
          discountAmount: null,
          total: '100',
          trackingToken: 'tok',
          createdAt: new Date('2026-02-01'),
        },
      ],
      items: [],
    });
    const auditLog = createMockAuditLog();
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      auditLog,
      mockPublicService,
    );

    const result = await service.exportData(ctx);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM `order` o'),
      expect.arrayContaining([ctx.customerId, ctx.shopId]),
    );
    expect(result.profile).toMatchObject({
      id: 1,
      name: 'Jane Shopper',
      phone: '0501234567',
    });
    expect(result.addresses).toEqual([
      { id: 'a1', address: '1 Main St', emirate: 'Dubai' },
    ]);
    expect(result.orders).toHaveLength(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('lastDataExportAt = ?'),
      [expect.any(Date), ctx.customerId],
    );
    expect(auditLog.log).toHaveBeenCalledWith(
      { shopId: ctx.shopId, actorUserId: 99 },
      expect.objectContaining({
        action: 'CUSTOMER_DATA_EXPORT',
        entityId: ctx.customerId,
      }),
    );
  });

  it('rejects a second export within 24h of the last one', async () => {
    const recentExport = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const db = createMockDb({
      customer: baseCustomer({ lastDataExportAt: recentExport }),
    });
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    await expect(service.exportData(ctx)).rejects.toThrow(BadRequestException);
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM `order` o'),
      expect.anything(),
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('allows a new export once 24h have passed since the last one', async () => {
    const oldExport = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    const db = createMockDb({
      customer: baseCustomer({ lastDataExportAt: oldExport }),
    });
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    await expect(service.exportData(ctx)).resolves.toBeDefined();
    expect(db.execute).toHaveBeenCalled();
  });
});

describe('CustomerAccountService.requestDeletion / confirmDeletion', () => {
  it('requestDeletion issues a hashed, 10-minute confirmationToken', async () => {
    const db = createMockDb({});
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    const result = await service.requestDeletion(ctx);

    expect(result.alreadyDeleted).toBe(false);
    if (result.alreadyDeleted) throw new Error('unreachable');
    expect(result.confirmationToken).toHaveLength(64); // 32 random bytes, hex
    expect(result.expiresInMinutes).toBe(10);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customerauthtoken'),
      [
        ctx.customerId,
        'account_deletion',
        hashToken(result.confirmationToken),
        expect.any(Date),
      ],
    );
  });

  it('confirmDeletion anonymises every PII field and revokes sessions', async () => {
    const raw = 'a'.repeat(64);
    const db = createMockDb({
      authToken: {
        id: 1,
        customerId: ctx.customerId,
        purpose: 'account_deletion',
        tokenHash: hashToken(raw),
        usedAt: null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    const result = await service.confirmDeletion(ctx, raw);

    expect(result).toEqual({ success: true });
    // Exact values, not just a pattern match — derived deterministically
    // from ctx.customerId (1), not a fresh random value per call. See the
    // "anonymise twice" test below for why that determinism matters.
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET name = ?, email = ?, phone = ?'),
      ['Deleted User', 'deleted-1@deleted.requital', 'DELETED-1', ctx.customerId],
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE customerrefreshtoken'),
      [expect.any(Date), ctx.customerId],
    );
    // The confirmation token itself is claimed (single-use CAS).
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE customerauthtoken SET usedAt'),
      [expect.any(Date), 1],
    );
  });

  it('rejects an expired confirmationToken', async () => {
    const raw = 'b'.repeat(64);
    const db = createMockDb({
      authToken: {
        id: 2,
        customerId: ctx.customerId,
        purpose: 'account_deletion',
        tokenHash: hashToken(raw),
        usedAt: null,
        expiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
      },
    });
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    await expect(service.confirmDeletion(ctx, raw)).rejects.toThrow(
      BadRequestException,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects a token already used once (second confirm attempt with the same token)', async () => {
    const raw = 'c'.repeat(64);
    const db = createMockDb({
      authToken: {
        id: 3,
        customerId: ctx.customerId,
        purpose: 'account_deletion',
        tokenHash: hashToken(raw),
        usedAt: null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    // Simulates losing the CAS — some other request already claimed it.
    db.execute.mockResolvedValue({ affectedRows: 0 });
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    await expect(service.confirmDeletion(ctx, raw)).rejects.toThrow(
      BadRequestException,
    );
    // Only the CAS claim ran — no anonymisation UPDATE followed it.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('an already-anonymised customer is a no-op for both requestDeletion and confirmDeletion', async () => {
    const db = createMockDb({
      customer: baseCustomer({ email: 'deleted-abc123@deleted.requital' }),
    });
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    const requestResult = await service.requestDeletion(ctx);
    expect(requestResult).toEqual({ alreadyDeleted: true });
    expect(db.execute).not.toHaveBeenCalled();

    const confirmResult = await service.confirmDeletion(ctx, 'whatever-token');
    expect(confirmResult).toEqual({ success: true });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('anonymising the same customer twice is idempotent — the second call writes nothing, and the values from the first call are unchanged', async () => {
    const raw = 'd'.repeat(64);
    // A stateful mock (not a static mockResolvedValue) so the second
    // confirmDeletion call actually observes the row left behind by the
    // first — the whole point of this test is proving the *sequence*
    // behaves correctly, which a fresh mock per call can't demonstrate.
    let customerState: Record<string, unknown> = baseCustomer();
    const authToken = {
      id: 1,
      customerId: ctx.customerId,
      purpose: 'account_deletion',
      tokenHash: hashToken(raw),
      usedAt: null,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM customer WHERE id')) {
        return Promise.resolve([customerState]);
      }
      if (sql.includes('FROM customerauthtoken WHERE tokenHash')) {
        return Promise.resolve([authToken]);
      }
      if (sql.includes('FROM user WHERE shopId')) {
        return Promise.resolve([{ id: 99 }]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const execute = jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('SET name = ?, email = ?, phone = ?')) {
        const [name, email, phone] = params;
        customerState = {
          ...customerState,
          name: name as string,
          email: email as string,
          phone: phone as string,
          birthday: null,
          passwordHash: null,
        };
      }
      return Promise.resolve({ affectedRows: 1, insertId: 1 });
    });
    const db = { query, execute } as unknown as DatabaseService & {
      query: jest.Mock;
      execute: jest.Mock;
    };
    const service = new CustomerAccountService(
      db,
      mockInvoicesService,
      createMockAuditLog(),
      mockPublicService,
    );

    const first = await service.confirmDeletion(ctx, raw);
    expect(first).toEqual({ success: true });
    const anonymiseCallsAfterFirst = execute.mock.calls.filter(([sql]) =>
      sql.includes('SET name = ?, email = ?, phone = ?'),
    ).length;
    expect(anonymiseCallsAfterFirst).toBe(1);
    const emailAfterFirstCall = customerState.email;
    const phoneAfterFirstCall = customerState.phone;
    expect(emailAfterFirstCall).toBe('deleted-1@deleted.requital');
    expect(phoneAfterFirstCall).toBe('DELETED-1');

    // Second confirm for the same customer — a retried request, or a
    // second outstanding confirmationToken from another tab. isAnonymised()
    // now sees the state the first call left behind and short-circuits
    // before writing anything a second time.
    const second = await service.confirmDeletion(ctx, raw);
    expect(second).toEqual({ success: true });
    const anonymiseCallsAfterSecond = execute.mock.calls.filter(([sql]) =>
      sql.includes('SET name = ?, email = ?, phone = ?'),
    ).length;
    expect(anonymiseCallsAfterSecond).toBe(1); // still just once
    expect(customerState.email).toBe(emailAfterFirstCall);
    expect(customerState.phone).toBe(phoneAfterFirstCall);
  });
});
