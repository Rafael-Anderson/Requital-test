import { ShopService } from './shop.service';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import type { DomainsService } from '../domains/domains.service';

const domainsMock = { invalidate: jest.fn() } as unknown as DomainsService;

function createMockDb(currentShop: Record<string, unknown>) {
  const query = jest.fn().mockResolvedValue([currentShop]);
  const execute = jest.fn().mockResolvedValue({ affectedRows: 1 });
  return { query, execute } as unknown as DatabaseService & {
    query: jest.Mock;
    execute: jest.Mock;
  };
}

const adminCtx: TenantContext = {
  userId: 1,
  shopId: 1,
  role: 'admin',
  outletId: null,
};

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
    businessHours: JSON.stringify({
      mon: { open: '09:00', close: '18:00', closed: false },
    }),
    deliveryHours: null,
    pickupHours: null,
    defaultDeliveryFee: '0.000000000000000000000000000000',
    taxRate: '0.000000000000000000000000000000',
    ...overrides,
  };
}

describe('ShopService — payment methods require at least one enabled', () => {
  it('rejects turning off the only enabled delivery payment method', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);

    await expect(
      service.update(adminCtx, { deliveryPaymentCardOnline: false } as any),
    ).rejects.toThrow('At least one delivery payment method must be enabled');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects turning off the only enabled pickup payment method', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);

    await expect(
      service.update(adminCtx, { pickupPaymentCardOnline: false } as any),
    ).rejects.toThrow('At least one pickup payment method must be enabled');
  });

  it('rejects creating an all-false delivery payment state across multiple fields in one request', async () => {
    const db = createMockDb(
      baseShop({
        deliveryPaymentCardOnline: true,
        deliveryPaymentCashOnDelivery: true,
      }),
    );
    const service = new ShopService(db, domainsMock);

    await expect(
      service.update(adminCtx, {
        deliveryPaymentCardOnline: false,
        deliveryPaymentCashOnDelivery: false,
      } as any),
    ).rejects.toThrow('At least one delivery payment method must be enabled');
  });

  it('allows switching which delivery method is enabled (one off, another on, in the same request)', async () => {
    const db = createMockDb(baseShop()); // cardOnline: true, others false
    const service = new ShopService(db, domainsMock);

    await service.update(adminCtx, {
      deliveryPaymentCardOnline: false,
      deliveryPaymentCashOnDelivery: true,
    });

    expect(db.execute).toHaveBeenCalled();
  });

  it('does not run the payment-method check (or the extra read) for unrelated updates', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);

    await service.update(adminCtx, { name: 'Renamed Shop' });

    // Only the final findOne() re-read happens — no extra pre-check read for
    // the untouched payment-method fields.
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalled();
  });

  it('pickup and delivery payment methods are validated independently — an all-false pickup request does not care about delivery state', async () => {
    const db = createMockDb(
      baseShop({
        deliveryPaymentCardOnline: false,
        deliveryPaymentCashOnDelivery: false,
        deliveryPaymentCardOnDelivery: false,
      }),
    );
    const service = new ShopService(db, domainsMock);

    // Delivery is already all-false in the stored row (pre-existing/legacy
    // state) — a request that only touches pickup must still succeed.

    await service.update(adminCtx, { pickupPaymentCashOnPickup: true });
    expect(db.execute).toHaveBeenCalled();
  });
});

describe('ShopService — domain configuration', () => {
  it('rejects a malformed custom domain without touching the database', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'subdomain',
        customDomain: null,
      }),
    );
    const service = new ShopService(db, domainsMock);

    await expect(
      service.updateDomain(adminCtx, {
        type: 'custom',
        customDomain: 'not a domain',
      }),
    ).rejects.toThrow('Enter a valid domain');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('normalizes a pasted URL before validating/storing it, and starts a pending claim', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'custom',
        customDomain: 'shop.acme.com',
      }),
    );
    // updateDomain reads the prior customDomain, then runs the "already
    // verified by another shop?" pre-check (-> nobody).
    db.query
      .mockResolvedValueOnce([{ customDomain: null }])
      .mockResolvedValueOnce([]);
    const service = new ShopService(db, domainsMock);

    await service.updateDomain(adminCtx, {
      type: 'custom',
      customDomain: 'HTTPS://Shop.Acme.com/',
    });

    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain("customDomainStatus = 'pending'");
    expect(params).toContain('shop.acme.com');
  });

  it('409s only when another shop has already VERIFIED the same custom domain (a pending claim does not block)', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'subdomain',
        customDomain: null,
      }),
    );
    // prior customDomain read, then the pre-check finds a different shop
    // already holding this domain verified.
    db.query
      .mockResolvedValueOnce([{ customDomain: null }])
      .mockResolvedValueOnce([{ id: 2 }]);
    const service = new ShopService(db, domainsMock);

    await expect(
      service.updateDomain(adminCtx, {
        type: 'custom',
        customDomain: 'taken.example.com',
      }),
    ).rejects.toThrow('already connected to another store');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('switching to type=subdomain clears customDomain in the same write', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'custom',
        customDomain: 'shop.acme.com',
      }),
    );
    const service = new ShopService(db, domainsMock);

    await service.updateDomain(adminCtx, { type: 'subdomain' });

    const [sql] = db.execute.mock.calls[0];
    expect(sql).toContain("domainType = 'subdomain'");
    expect(sql).toContain('customDomain = NULL');
  });

  it('computes storefrontUrl from the shop subdomain when type=subdomain', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'subdomain',
        customDomain: null,
      }),
    );
    const service = new ShopService(db, domainsMock);

    const result = await service.getDomainConfig(adminCtx);
    expect(result.storefrontUrl).toBe('https://acme.requital.io');
  });

  it('computes storefrontUrl from customDomain when type=custom', async () => {
    const db = createMockDb(
      baseShop({
        subdomain: 'acme',
        domainType: 'custom',
        customDomain: 'shop.acme.com',
      }),
    );
    const service = new ShopService(db, domainsMock);

    const result = await service.getDomainConfig(adminCtx);
    expect(result.storefrontUrl).toBe('https://shop.acme.com');
  });
});

describe('ShopService — store/delivery/pickup hours are independent records', () => {
  it('updating deliveryHours does not touch businessHours or pickupHours in the write', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);
    const newHours = { mon: { open: '10:00', close: '20:00', closed: false } };

    await service.update(adminCtx, { deliveryHours: newHours });

    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('`deliveryHours`');
    expect(params).toContain(JSON.stringify(newHours));
    expect(sql).not.toContain('`businessHours`');
    expect(sql).not.toContain('`pickupHours`');
  });

  it('updating pickupHours does not touch businessHours or deliveryHours in the write', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);
    const newHours = { tue: { open: '11:00', close: '15:00', closed: false } };

    await service.update(adminCtx, { pickupHours: newHours });

    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('`pickupHours`');
    expect(params).toContain(JSON.stringify(newHours));
    expect(sql).not.toContain('`businessHours`');
    expect(sql).not.toContain('`deliveryHours`');
  });

  it('updating businessHours (store hours) does not touch deliveryHours or pickupHours in the write', async () => {
    const db = createMockDb(baseShop());
    const service = new ShopService(db, domainsMock);
    const newHours = JSON.stringify({
      wed: { open: '08:00', close: '22:00', closed: false },
    });

    await service.update(adminCtx, { businessHours: newHours });

    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('`businessHours`');
    expect(params).toContain(newHours);
    expect(sql).not.toContain('`deliveryHours`');
    expect(sql).not.toContain('`pickupHours`');
  });
});
