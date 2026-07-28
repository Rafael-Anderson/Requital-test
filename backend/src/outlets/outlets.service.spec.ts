import { OutletsService } from './outlets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';

// No distance/haversine calculation exists anywhere in this codebase — the
// delivery radius is captured/persisted only, not enforced against anything
// yet (no checkout exists to check it against). This suite regression-tests
// that the deliveryRadiusKm + latitude/longitude wiring itself — validation
// and persistence — still works correctly after adding the deliveryZones
// reservation column, not a distance formula that doesn't exist.

function createMockPrisma() {
  return {
    outlet: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaService;
}

const adminCtx: TenantContext = { userId: 1, shopId: 1, role: 'admin', outletId: null };

describe('OutletsService — delivery radius/coordinates wiring', () => {
  it('create() persists deliveryRadiusKm with latitude/longitude together', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.create as jest.Mock).mockResolvedValue({ id: 1 });
    const service = new OutletsService(prisma);

    await service.create(adminCtx, {
      name: 'Test Outlet',
      deliveryEnabled: true,
      deliveryRadiusKm: 7.5,
      latitude: 25.2,
      longitude: 55.3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(prisma.outlet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryEnabled: true,
          deliveryRadiusKm: 7.5,
          latitude: 25.2,
          longitude: 55.3,
        }),
      }),
    );
  });

  it('create() rejects delivery enabled without coordinates', () => {
    const prisma = createMockPrisma();
    const service = new OutletsService(prisma);

    // validateDelivery throws synchronously inside the (non-async) create()
    // method, so this is a plain throw, not a rejected promise.
    expect(() =>
      service.create(adminCtx, {
        name: 'Test Outlet',
        deliveryEnabled: true,
        deliveryRadiusKm: 5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toThrow('Outlet coordinates are required when delivery is enabled');
    expect(prisma.outlet.create).not.toHaveBeenCalled();
  });

  it('create() rejects delivery enabled without a radius', () => {
    const prisma = createMockPrisma();
    const service = new OutletsService(prisma);

    expect(() =>
      service.create(adminCtx, {
        name: 'Test Outlet',
        deliveryEnabled: true,
        latitude: 25.2,
        longitude: 55.3,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toThrow('Delivery radius (km) is required when delivery is enabled');
    expect(prisma.outlet.create).not.toHaveBeenCalled();
  });

  it('update() validates against the stored outlet\'s existing coordinates when the request omits them', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      shopId: 1,
      latitude: 25.1,
      longitude: 55.2,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      closedOverride: false,
    });
    (prisma.outlet.update as jest.Mock).mockResolvedValue({ id: 5 });
    const service = new OutletsService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, 5, { deliveryEnabled: true, deliveryRadiusKm: 3 } as any);

    expect(prisma.outlet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ deliveryEnabled: true, deliveryRadiusKm: 3 }),
      }),
    );
  });

  it('update() rejects enabling delivery when neither the request nor the stored outlet has coordinates', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      shopId: 1,
      latitude: null,
      longitude: null,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      closedOverride: false,
    });
    const service = new OutletsService(prisma);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.update(adminCtx, 5, { deliveryEnabled: true, deliveryRadiusKm: 3 } as any),
    ).rejects.toThrow('Outlet coordinates are required when delivery is enabled');
    expect(prisma.outlet.update).not.toHaveBeenCalled();
  });

  it('update() leaves an already-delivery-enabled outlet\'s radius/coordinates alone when this request does not touch delivery', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      shopId: 1,
      latitude: 25.1,
      longitude: 55.2,
      deliveryEnabled: true,
      deliveryRadiusKm: 10,
      closedOverride: false,
    });
    (prisma.outlet.update as jest.Mock).mockResolvedValue({ id: 5 });
    const service = new OutletsService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, 5, { name: 'Renamed' } as any);

    expect(prisma.outlet.update).toHaveBeenCalled();
  });
});

describe('OutletsService — closedOverride timestamp stamping', () => {
  it('create() stamps closedOverrideSetAt when created with the override already on', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.create as jest.Mock).mockResolvedValue({ id: 1 });
    const service = new OutletsService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.create(adminCtx, { name: 'Test Outlet', closedOverride: true } as any);

    const { data } = (prisma.outlet.create as jest.Mock).mock.calls[0][0];
    expect(data.closedOverride).toBe(true);
    expect(data.closedOverrideSetAt).toBeInstanceOf(Date);
  });

  it('update() clears closedOverrideSetAt when the override is explicitly turned off', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      shopId: 1,
      latitude: null,
      longitude: null,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      closedOverride: true,
    });
    (prisma.outlet.update as jest.Mock).mockResolvedValue({ id: 5 });
    const service = new OutletsService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, 5, { closedOverride: false } as any);

    const { data } = (prisma.outlet.update as jest.Mock).mock.calls[0][0];
    expect(data.closedOverride).toBe(false);
    expect(data.closedOverrideSetAt).toBeNull();
  });

  it('update() leaves closedOverrideSetAt untouched when this request does not mention closedOverride', async () => {
    const prisma = createMockPrisma();
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({
      id: 5,
      shopId: 1,
      latitude: null,
      longitude: null,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      closedOverride: true,
    });
    (prisma.outlet.update as jest.Mock).mockResolvedValue({ id: 5 });
    const service = new OutletsService(prisma);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.update(adminCtx, 5, { name: 'Renamed' } as any);

    const { data } = (prisma.outlet.update as jest.Mock).mock.calls[0][0];
    expect(data).not.toHaveProperty('closedOverrideSetAt');
  });
});

describe('OutletsService.geocode', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps a successful Nominatim result to latitude/longitude/displayName', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: '25.197044', lon: '55.2789516', display_name: 'Dubai Mall, Dubai, UAE' },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const service = new OutletsService(createMockPrisma());

    const result = await service.geocode('Dubai Mall');

    expect(result).toEqual({
      latitude: 25.197044,
      longitude: 55.2789516,
      displayName: 'Dubai Mall, Dubai, UAE',
    });
  });

  // The bug this regression-tests: Nominatim returning zero results used to
  // become a bare `return null`, which Nest serializes as an empty response
  // body (no Content-Type, Content-Length: 0) rather than the JSON literal
  // `null` — the frontend's `res.json()` on that then throws "Unexpected
  // end of JSON input". A thrown NotFoundException always gets a real JSON
  // body from Nest's exception filter, so it can't reproduce that failure.
  it('throws NotFoundException (not a bare null) when Nominatim returns zero results', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const service = new OutletsService(createMockPrisma());

    await expect(service.geocode('zzznonexistentplace')).rejects.toThrow(
      'No location found for that search',
    );
  });

  it('rejects an empty query without calling fetch', async () => {
    global.fetch = jest.fn();
    const service = new OutletsService(createMockPrisma());

    await expect(service.geocode('')).rejects.toThrow('A search query is required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws a friendly error when the upstream request itself fails (network/non-200)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false } as unknown as Response);
    const service = new OutletsService(createMockPrisma());

    await expect(service.geocode('Dubai Mall')).rejects.toThrow('Geocoding lookup failed');
  });

  it('sends the required Nominatim User-Agent header', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '1', lon: '2', display_name: 'x' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const service = new OutletsService(createMockPrisma());

    await service.geocode('Dubai Mall');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    // Shared with the public storefront geocode endpoint now — see
    // common/nominatim.ts — so this no longer says "-Admin" specifically.
    expect(options.headers['User-Agent']).toContain('Requital');
  });
});
