import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import type { PaymentSettingsService } from './payment-settings.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import { TelrPaymentProvider } from './providers/telr-payment.provider';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  PaymentProvider,
  WebhookResult,
} from './payment-provider.interface';
import type { BranchRolesService } from '../branch-roles/branch-roles.service';

// None of these tests exercise generateLink() (the only method that
// actually calls into branch-roles), so a bare mock is enough to satisfy
// the constructor.
const mockBranchRolesService = {} as BranchRolesService;

function createMockPrisma(opts: {
  order?: { id: number; total: Prisma.Decimal | number } | null;
  createRejectsWith?: unknown;
}) {
  const order = opts.order ?? null;
  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({}),
    },
    paymenttransaction: {
      create: jest.fn(() =>
        opts.createRejectsWith
          ? Promise.reject(opts.createRejectsWith)
          : Promise.resolve({}),
      ),
    },
    // Array-form $transaction: reject like the real thing if any operation
    // in the array is itself a rejected promise by the time this runs.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
}

class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  constructor(private readonly result: WebhookResult | null) {}
  createCheckoutSession = jest.fn();
  parseWebhookEvent(): WebhookResult | null {
    return this.result;
  }
}

// A P2002 (unique constraint violation) as thrown by the real Prisma client
// on a duplicate (gateway, gatewayReference) insert.
function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PaymentsService.handleWebhook — idempotency (shared across every gateway)', () => {
  it('a stub provider (e.g. Telr) that has no real parseWebhookEvent implementation safely no-ops', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new TelrPaymentProvider());
    const prisma = createMockPrisma({});
    const service = new PaymentsService(
      prisma,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
    );

    const result = await service.handleWebhook(
      'telr',
      Buffer.from('{}'),
      'sig',
    );

    expect(result).toEqual({ received: true });
    expect(prisma.paymenttransaction.create).not.toHaveBeenCalled();
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
    const prisma = createMockPrisma({
      order: { id: 42, total: new Prisma.Decimal(100) },
    });
    const affiliateService = {
      syncOrderStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const service = new PaymentsService(
      prisma,
      registry,
      {} as PaymentSettingsService,
      affiliateService,
      mockBranchRolesService,
    );

    const result = await service.handleWebhook(
      'fake',
      Buffer.from('{}'),
      'sig',
    );

    expect(result).toEqual({ received: true });
    expect(prisma.paymenttransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 42,
          gateway: 'fake',
          gatewayReference: 'evt_1',
        }),
      }),
    );
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { paymentStatus: 'paid' },
    });
  });

  it('a duplicate delivery of the same event (P2002 on gateway+gatewayReference) is swallowed, not re-applied or thrown', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(
      new FakeProvider({
        providerReference: 'evt_dup',
        orderId: 7,
        status: 'paid',
      }),
    );
    const prisma = createMockPrisma({
      order: { id: 7, total: new Prisma.Decimal(50) },
      createRejectsWith: p2002(),
    });
    const service = new PaymentsService(
      prisma,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
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
    const prisma = createMockPrisma({ order: null });
    const service = new PaymentsService(
      prisma,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
    );

    const result = await service.handleWebhook(
      'fake',
      Buffer.from('{}'),
      'sig',
    );
    expect(result).toEqual({ received: true });
    expect(prisma.paymenttransaction.create).not.toHaveBeenCalled();
  });

  it('an unregistered gateway name throws rather than silently doing nothing', async () => {
    const registry = new PaymentProviderRegistry();
    const prisma = createMockPrisma({});
    const service = new PaymentsService(
      prisma,
      registry,
      {} as PaymentSettingsService,
      {} as AffiliateService,
      mockBranchRolesService,
    );

    await expect(
      service.handleWebhook('unknown-gateway', Buffer.from('{}'), 'sig'),
    ).rejects.toThrow(
      "Unknown or unconfigured payment gateway 'unknown-gateway'",
    );
  });
});
