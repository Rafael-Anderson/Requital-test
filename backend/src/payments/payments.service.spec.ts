import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import type { PaymentSettingsService } from './payment-settings.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import { TelrPaymentProvider } from './providers/telr-payment.provider';
import type { DatabaseService } from '../database/database.service';
import type {
  PaymentProvider,
  WebhookResult,
} from './payment-provider.interface';
import type { BranchRolesService } from '../branch-roles/branch-roles.service';
import type { OrdersService } from '../orders/orders.service';

// None of these tests exercise generateLink() (the only method that
// actually calls into branch-roles), so a bare mock is enough to satisfy
// the constructor.
const mockBranchRolesService = {} as BranchRolesService;
// None of these tests produce a WebhookResult with advanceOrderStatus set
// (that's covered by the "BNPL advanceOrderStatus" describe block and
// tabby/tamara-payment.provider.spec.ts instead), so a bare mock is enough
// here too.
const mockOrdersService = {} as OrdersService;
// The BNPL advanceOrderStatus tests below all use a 'paid' WebhookResult
// status (same as every other "paid" test above), which always drives
// AffiliateService.syncOrderStatus too — a working stub avoids that
// unrelated call throwing and masking the actual behavior under test.
const mockAffiliateServicePaid = {
  syncOrderStatus: jest.fn().mockResolvedValue(undefined),
} as unknown as AffiliateService;

function duplicateKeyError() {
  return Object.assign(new Error('Duplicate entry'), { errno: 1062 });
}

function createMockDb(opts: {
  order?: {
    id: number;
    total: number;
    shopId?: number;
    status?: string;
  } | null;
  createRejectsWith?: unknown;
  adminUser?: { id: number } | null;
}) {
  const order = opts.order ?? null;
  const insertCalls: unknown[][] = [];
  const orderUpdateCalls: unknown[][] = [];

  interface MockConn {
    query: jest.Mock;
  }
  const conn: MockConn = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO paymenttransaction')) {
        insertCalls.push(params ?? []);
        if (opts.createRejectsWith) {
          return Promise.reject(opts.createRejectsWith);
        }
        return Promise.resolve([{ insertId: 1 }, []]);
      }
      if (sql.includes("UPDATE `order` SET paymentStatus")) {
        orderUpdateCalls.push(params ?? []);
        return Promise.resolve([{ affectedRows: 1 }, []]);
      }
      return Promise.resolve([[], []]);
    }),
  };

  const db = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM `order`')) {
        return Promise.resolve(order ? [order] : []);
      }
      if (sql.includes('FROM user')) {
        const adminUser =
          opts.adminUser !== undefined ? opts.adminUser : { id: 1 };
        return Promise.resolve(adminUser ? [adminUser] : []);
      }
      return Promise.resolve([]);
    }),
    execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    transaction: jest.fn((cb: (conn: MockConn) => Promise<unknown>) =>
      cb(conn),
    ),
  } as unknown as DatabaseService;

  return { db, insertCalls, orderUpdateCalls };
}

class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  constructor(private readonly result: WebhookResult | null) {}
  createCheckoutSession = jest.fn();
  parseWebhookEvent(): WebhookResult | null {
    return this.result;
  }
}

describe('PaymentsService.handleWebhook — idempotency (shared across every gateway)', () => {
  it('a stub provider (e.g. Telr) that has no real parseWebhookEvent implementation safely no-ops', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new TelrPaymentProvider());
    const { db } = createMockDb({});
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
      mockOrdersService,
    );

    const result = await service.handleWebhook(
      'telr',
      Buffer.from('{}'),
      'sig',
    );

    expect(result).toEqual({ received: true });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('records the transaction and marks the order paid on a recognized "paid" event', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_1',
        orderId: 42,
        status: 'paid',
      }),
    );
    const { db, insertCalls, orderUpdateCalls } = createMockDb({
      order: { id: 42, total: 100 },
    });
    const affiliateService = {
      syncOrderStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      affiliateService,
      mockBranchRolesService,
      mockOrdersService,
    );

    const result = await service.handleWebhook(
      'fake',
      Buffer.from('{}'),
      'sig',
    );

    expect(result).toEqual({ received: true });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual(
      expect.arrayContaining([42, 'fake', 'evt_1']),
    );
    expect(orderUpdateCalls).toHaveLength(1);
    expect(orderUpdateCalls[0]).toEqual([42]);
  });

  it('a duplicate delivery of the same event (errno 1062 on gateway+gatewayReference) is swallowed, not re-applied or thrown', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_dup',
        orderId: 7,
        status: 'paid',
      }),
    );
    const { db } = createMockDb({
      order: { id: 7, total: 50 },
      createRejectsWith: duplicateKeyError(),
    });
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
      mockOrdersService,
    );

    await expect(
      service.handleWebhook('fake', Buffer.from('{}'), 'sig'),
    ).resolves.toEqual({
      received: true,
    });
  });

  it('an unrecognized orderId (order not found) is a safe no-op, not an error', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_2',
        orderId: 999,
        status: 'paid',
      }),
    );
    const { db } = createMockDb({ order: null });
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
      mockOrdersService,
    );

    const result = await service.handleWebhook(
      'fake',
      Buffer.from('{}'),
      'sig',
    );
    expect(result).toEqual({ received: true });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('an unregistered gateway name throws rather than silently doing nothing', async () => {
    const registry = new PaymentProviderRegistry();
    const { db } = createMockDb({});
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
      mockOrdersService,
    );

    await expect(
      service.handleWebhook('unknown-gateway', Buffer.from('{}'), 'sig'),
    ).rejects.toThrow(
      "Unknown or unconfigured payment gateway 'unknown-gateway'",
    );
  });
});

describe('PaymentsService.handleWebhook — BNPL advanceOrderStatus (Tabby/Tamara)', () => {
  it("a 'confirmed' result drives OrdersService.updateStatus under a synthesized admin context, while the order is still pending", async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_1',
        orderId: 10,
        status: 'paid',
        advanceOrderStatus: 'confirmed',
      }),
    );
    const { db } = createMockDb({
      order: {
        id: 10,
        shopId: 5,
        status: 'pending',
        total: 100,
      },
      adminUser: { id: 77 },
    });
    const ordersService = {
      updateStatus: jest.fn().mockResolvedValue({}),
      cancel: jest.fn(),
    } as unknown as OrdersService;
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      mockAffiliateServicePaid,
      mockBranchRolesService,
      ordersService,
    );

    await service.handleWebhook('fake', Buffer.from('{}'), 'sig');

    expect(ordersService.updateStatus).toHaveBeenCalledWith(
      { userId: 77, shopId: 5, role: 'admin', outletId: null },
      10,
      { status: 'confirmed' },
    );
    expect(ordersService.cancel).not.toHaveBeenCalled();
  });

  it("a 'cancelled' result drives OrdersService.cancel while the order is still pending", async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_2',
        orderId: 11,
        status: 'failed',
        advanceOrderStatus: 'cancelled',
      }),
    );
    const { db } = createMockDb({
      order: {
        id: 11,
        shopId: 5,
        status: 'pending',
        total: 100,
      },
    });
    const ordersService = {
      updateStatus: jest.fn(),
      cancel: jest.fn().mockResolvedValue({}),
    } as unknown as OrdersService;
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
      ordersService,
    );

    await service.handleWebhook('fake', Buffer.from('{}'), 'sig');

    expect(ordersService.cancel).toHaveBeenCalledWith(
      { userId: 1, shopId: 5, role: 'admin', outletId: null },
      11,
    );
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
  });

  it('a stale signal on an order the merchant already moved past pending is silently ignored, never forced through', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_3',
        orderId: 12,
        status: 'paid',
        advanceOrderStatus: 'confirmed',
      }),
    );
    const { db } = createMockDb({
      order: {
        id: 12,
        shopId: 5,
        status: 'preparing', // already moved on by staff
        total: 100,
      },
    });
    const ordersService = {
      updateStatus: jest.fn(),
      cancel: jest.fn(),
    } as unknown as OrdersService;
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      mockAffiliateServicePaid,
      mockBranchRolesService,
      ordersService,
    );

    const result = await service.handleWebhook(
      'fake',
      Buffer.from('{}'),
      'sig',
    );

    expect(result).toEqual({ received: true }); // webhook itself still succeeds
    expect(ordersService.updateStatus).not.toHaveBeenCalled();
    expect(ordersService.cancel).not.toHaveBeenCalled();
  });

  it('a CAS/validation exception from the underlying status transition never fails the webhook response', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_4',
        orderId: 13,
        status: 'paid',
        advanceOrderStatus: 'confirmed',
      }),
    );
    const { db } = createMockDb({
      order: {
        id: 13,
        shopId: 5,
        status: 'pending',
        total: 100,
      },
    });
    const ordersService = {
      updateStatus: jest.fn().mockRejectedValue(new Error('conflict')),
      cancel: jest.fn(),
    } as unknown as OrdersService;
    const service = new PaymentsService(
      db,
      registry,
      {} as PaymentSettingsService,
      mockAffiliateServicePaid,
      mockBranchRolesService,
      ordersService,
    );

    await expect(
      service.handleWebhook('fake', Buffer.from('{}'), 'sig'),
    ).resolves.toEqual({ received: true });
  });
});
