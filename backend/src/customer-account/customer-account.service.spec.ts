import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CustomerAccountService } from './customer-account.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { InvoicesService } from '../invoices/invoices.service';
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

function createMockPrisma(opts: {
  customer?: ReturnType<typeof baseCustomer>;
  orders?: unknown[];
  authToken?: Record<string, unknown> | null;
  adminUser?: { id: number } | null;
}) {
  return {
    customer: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(opts.customer ?? baseCustomer()),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
    },
    customerauthtoken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(opts.authToken ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerrefreshtoken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.adminUser ?? { id: 99 }),
    },
  } as unknown as PrismaService;
}

const mockInvoicesService = {} as InvoicesService;

function createMockAuditLog() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
}

describe('CustomerAccountService.exportData', () => {
  it('returns profile/addresses/orders scoped to (ctx.customerId, ctx.shopId), and stamps lastDataExportAt', async () => {
    const prisma = createMockPrisma({
      orders: [
        {
          id: 5,
          status: 'delivered',
          orderType: 'delivery',
          paymentStatus: 'paid',
          paymentMethod: 'cash_on_delivery',
          outlet: { name: 'Main' },
          deliveryDate: null,
          deliveryTimeSlot: null,
          customerAddress: '1 Main St',
          orderitem: [],
          deliveryFee: null,
          taxAmount: null,
          discountAmount: null,
          total: '100',
          trackingToken: 'tok',
          createdAt: new Date('2026-02-01'),
        },
      ],
    });
    const auditLog = createMockAuditLog();
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      auditLog,
    );

    const result = await service.exportData(ctx);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: ctx.customerId, shopId: ctx.shopId },
      }),
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
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: ctx.customerId },
      data: { lastDataExportAt: expect.any(Date) },
    });
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
    const prisma = createMockPrisma({
      customer: baseCustomer({ lastDataExportAt: recentExport }),
    });
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    await expect(service.exportData(ctx)).rejects.toThrow(BadRequestException);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('allows a new export once 24h have passed since the last one', async () => {
    const oldExport = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    const prisma = createMockPrisma({
      customer: baseCustomer({ lastDataExportAt: oldExport }),
    });
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    await expect(service.exportData(ctx)).resolves.toBeDefined();
    expect(prisma.customer.update).toHaveBeenCalled();
  });
});

describe('CustomerAccountService.requestDeletion / confirmDeletion', () => {
  it('requestDeletion issues a hashed, 10-minute confirmationToken', async () => {
    const prisma = createMockPrisma({});
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    const result = await service.requestDeletion(ctx);

    expect(result.alreadyDeleted).toBe(false);
    if (result.alreadyDeleted) throw new Error('unreachable');
    expect(result.confirmationToken).toHaveLength(64); // 32 random bytes, hex
    expect(result.expiresInMinutes).toBe(10);
    expect(prisma.customerauthtoken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: ctx.customerId,
          purpose: 'account_deletion',
          tokenHash: hashToken(result.confirmationToken),
        }),
      }),
    );
  });

  it('confirmDeletion anonymises every PII field and revokes sessions', async () => {
    const raw = 'a'.repeat(64);
    const prisma = createMockPrisma({
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
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    const result = await service.confirmDeletion(ctx, raw);

    expect(result).toEqual({ success: true });
    // Exact values, not just a pattern match — derived deterministically
    // from ctx.customerId (1), not a fresh random value per call. See the
    // "anonymise twice" test below for why that determinism matters.
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: ctx.customerId },
      data: expect.objectContaining({
        name: 'Deleted User',
        email: 'deleted-1@deleted.requital',
        phone: 'DELETED-1',
        birthday: null,
        passwordHash: null,
      }),
    });
    expect(prisma.customerrefreshtoken.updateMany).toHaveBeenCalledWith({
      where: { customerId: ctx.customerId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // The confirmation token itself is claimed (single-use CAS).
    expect(prisma.customerauthtoken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, usedAt: null } }),
    );
  });

  it('rejects an expired confirmationToken', async () => {
    const raw = 'b'.repeat(64);
    const prisma = createMockPrisma({
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
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    await expect(service.confirmDeletion(ctx, raw)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('rejects a token already used once (second confirm attempt with the same token)', async () => {
    const raw = 'c'.repeat(64);
    const prisma = createMockPrisma({
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
    prisma.customerauthtoken.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 0 });
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    await expect(service.confirmDeletion(ctx, raw)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('an already-anonymised customer is a no-op for both requestDeletion and confirmDeletion', async () => {
    const prisma = createMockPrisma({
      customer: baseCustomer({ email: 'deleted-abc123@deleted.requital' }),
    });
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    const requestResult = await service.requestDeletion(ctx);
    expect(requestResult).toEqual({ alreadyDeleted: true });
    expect(prisma.customerauthtoken.create).not.toHaveBeenCalled();

    const confirmResult = await service.confirmDeletion(ctx, 'whatever-token');
    expect(confirmResult).toEqual({ success: true });
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('anonymising the same customer twice is idempotent — the second call writes nothing, and the values from the first call are unchanged', async () => {
    const raw = 'd'.repeat(64);
    // A stateful mock (not a static mockResolvedValue) so the second
    // confirmDeletion call actually observes the row left behind by the
    // first — the whole point of this test is proving the *sequence*
    // behaves correctly, which a fresh mock per call can't demonstrate.
    let customerState = baseCustomer();
    const prisma = {
      customer: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve(customerState)),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          customerState = {
            ...customerState,
            ...args.data,
          };
          return Promise.resolve(customerState);
        }),
      },
      customerauthtoken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          customerId: ctx.customerId,
          purpose: 'account_deletion',
          tokenHash: hashToken(raw),
          usedAt: null,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerrefreshtoken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 99 }) },
    } as unknown as PrismaService;
    const service = new CustomerAccountService(
      prisma,
      mockInvoicesService,
      createMockAuditLog(),
    );

    const first = await service.confirmDeletion(ctx, raw);
    expect(first).toEqual({ success: true });
    expect(prisma.customer.update).toHaveBeenCalledTimes(1);
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
    expect(prisma.customer.update).toHaveBeenCalledTimes(1); // still just once
    expect(customerState.email).toBe(emailAfterFirstCall);
    expect(customerState.phone).toBe(phoneAfterFirstCall);
  });
});
