import { ShopService } from './shop.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';

function createMockPrisma(currentShop: Record<string, unknown>) {
  return {
    shop: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(currentShop),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...currentShop, ...data })),
    },
  } as unknown as PrismaService;
}

const adminCtx: TenantContext = { userId: 1, shopId: 1, role: 'admin', outletId: null };

// A shop with exactly one payment method on per context — the minimum valid
// starting state, so tests can flip that one method off and expect a reject.
function baseShop(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    deliveryPaymentCardOnline: true,
    deliveryPaymentCashOnDelivery: false,
    deliveryPaymentCardOnDelivery: false,
    pickupPaymentCardOnline: true,
    pickupPaymentCashOnPickup: false,
    pickupPaymentCardOnPickup: false,
    businessHours: { mon: { open: '09:00', close: '18:00', closed: false } },
    deliveryHours: null,
    pickupHours: null,
    ...overrides,
  };
}

describe('ShopService — payment methods require at least one enabled', () => {
  it('rejects turning off the only enabled delivery payment method', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.update(adminCtx, { deliveryPaymentCardOnline: false } as any),
    ).rejects.toThrow('At least one delivery payment method must be enabled');
    expect(prisma.shop.update).not.toHaveBeenCalled();
  });

  it('rejects turning off the only enabled pickup payment method', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.update(adminCtx, { pickupPaymentCardOnline: false } as any),
    ).rejects.toThrow('At least one pickup payment method must be enabled');
  });

  it('rejects creating an all-false delivery payment state across multiple fields in one request', async () => {
    const prisma = createMockPrisma(
      baseShop({ deliveryPaymentCardOnline: true, deliveryPaymentCashOnDelivery: true }),
    );
    const service = new ShopService(prisma);

    await expect(
      service.update(adminCtx, {
        deliveryPaymentCardOnline: false,
        deliveryPaymentCashOnDelivery: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).rejects.toThrow('At least one delivery payment method must be enabled');
  });

  it('allows switching which delivery method is enabled (one off, another on, in the same request)', async () => {
    const prisma = createMockPrisma(baseShop()); // cardOnline: true, others false
    const service = new ShopService(prisma);

    await service.update(adminCtx, {
      deliveryPaymentCardOnline: false,
      deliveryPaymentCashOnDelivery: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.shop.update).toHaveBeenCalled();
  });

  it('does not run the payment-method check (or the extra read) for unrelated updates', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, { name: 'Renamed Shop' } as any);

    expect(prisma.shop.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.shop.update).toHaveBeenCalled();
  });

  it('pickup and delivery payment methods are validated independently — an all-false pickup request does not care about delivery state', async () => {
    const prisma = createMockPrisma(baseShop({ deliveryPaymentCardOnline: false, deliveryPaymentCashOnDelivery: false, deliveryPaymentCardOnDelivery: false }));
    const service = new ShopService(prisma);

    // Delivery is already all-false in the stored row (pre-existing/legacy
    // state) — a request that only touches pickup must still succeed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, { pickupPaymentCashOnPickup: true } as any);
    expect(prisma.shop.update).toHaveBeenCalled();
  });
});

describe('ShopService — store/delivery/pickup hours are independent records', () => {
  it('updating deliveryHours does not touch businessHours or pickupHours in the write', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);
    const newHours = { mon: { open: '10:00', close: '20:00', closed: false } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, { deliveryHours: newHours } as any);

    const { data } = (prisma.shop.update as jest.Mock).mock.calls[0][0];
    expect(data.deliveryHours).toEqual(newHours);
    expect(data).not.toHaveProperty('businessHours');
    expect(data).not.toHaveProperty('pickupHours');
  });

  it('updating pickupHours does not touch businessHours or deliveryHours in the write', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);
    const newHours = { tue: { open: '11:00', close: '15:00', closed: false } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, { pickupHours: newHours } as any);

    const { data } = (prisma.shop.update as jest.Mock).mock.calls[0][0];
    expect(data.pickupHours).toEqual(newHours);
    expect(data).not.toHaveProperty('businessHours');
    expect(data).not.toHaveProperty('deliveryHours');
  });

  it('updating businessHours (store hours) does not touch deliveryHours or pickupHours in the write', async () => {
    const prisma = createMockPrisma(baseShop());
    const service = new ShopService(prisma);
    const newHours = { wed: { open: '08:00', close: '22:00', closed: false } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, { businessHours: newHours } as any);

    const { data } = (prisma.shop.update as jest.Mock).mock.calls[0][0];
    expect(data.businessHours).toEqual(newHours);
    expect(data).not.toHaveProperty('deliveryHours');
    expect(data).not.toHaveProperty('pickupHours');
  });
});
