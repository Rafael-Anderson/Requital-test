import { DeliveryZonesService } from './delivery-zones.service';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import type { BranchRolesService } from '../branch-roles/branch-roles.service';

const mockBranchRolesService = {
  assertPermission: jest.fn().mockResolvedValue(undefined),
} as unknown as BranchRolesService;

function createMockDb() {
  return {
    query: jest.fn().mockResolvedValue([{ id: 5 }]),
    execute: jest.fn().mockResolvedValue({ insertId: 1 }),
    transaction: jest.fn(),
  } as unknown as DatabaseService & { query: jest.Mock; execute: jest.Mock };
}

function insertFields(sql: string, params: unknown[]): Record<string, unknown> {
  const match = sql.match(/INSERT INTO deliveryzone \(([\s\S]*?)\)/)!;
  const columns = match[1].split(',').map((c) => c.trim());
  return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
}

function updateFields(sql: string, params: unknown[]): Record<string, unknown> {
  const match = sql.match(/SET ([\s\S]*?) WHERE/)!;
  const columns = match[1]
    .split(',')
    .map((c) => c.trim().replace(/`/g, '').replace(/\s*=\s*\?$/, ''));
  return Object.fromEntries(columns.map((c, i) => [c, params[i]]));
}

const adminCtx: TenantContext = {
  userId: 1,
  shopId: 1,
  role: 'admin',
  outletId: null,
};

describe('DeliveryZonesService — map center/radius wiring', () => {
  it('create() persists lat/lng/radiusKm alongside the flat-fee fields', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ id: 10 }]);
    const service = new DeliveryZonesService(db, mockBranchRolesService);

    await service.create(adminCtx, 10, {
      name: 'Dubai',
      fee: 15,
      lat: 25.2048,
      lng: 55.2708,
      radiusKm: 12.5,
    });

    const [sql, params] = db.execute.mock.calls[0];
    expect(insertFields(sql, params)).toMatchObject({
      outletId: 10,
      name: 'Dubai',
      lat: 25.2048,
      lng: 55.2708,
      radiusKm: 12.5,
    });
  });

  it('create() defaults lat/lng/radiusKm to null when not provided', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ id: 10 }]);
    const service = new DeliveryZonesService(db, mockBranchRolesService);

    await service.create(adminCtx, 10, { name: 'Sharjah', fee: 20 });

    const [sql, params] = db.execute.mock.calls[0];
    expect(insertFields(sql, params)).toMatchObject({
      lat: null,
      lng: null,
      radiusKm: null,
    });
  });

  it('update() only sets lat/lng/radiusKm when actually sent', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ id: 10 }]);
    const service = new DeliveryZonesService(db, mockBranchRolesService);

    await service.update(adminCtx, 10, 5, { radiusKm: 8 });

    const [sql, params] = db.execute.mock.calls[0];
    const fields = updateFields(sql, params);
    expect(fields.radiusKm).toBe(8);
    expect(fields).not.toHaveProperty('lat');
    expect(fields).not.toHaveProperty('lng');
  });
});
