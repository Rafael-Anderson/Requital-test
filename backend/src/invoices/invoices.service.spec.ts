import { NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { OrdersService } from '../orders/orders.service';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';

function duplicateKeyError() {
  return Object.assign(new Error('Duplicate entry'), { errno: 1062 });
}

function ctxFor(shopId: number): TenantContext {
  return { userId: 1, shopId, role: 'admin', outletId: null };
}

function fakeOrder(overrides: Partial<{ id: number; shopId: number }> = {}) {
  return {
    id: overrides.id ?? 1,
    shopId: overrides.shopId ?? 1,
    total: '21',
    taxAmount: '1',
    orderitem: [{ priceAtPurchase: '10', quantity: 2 }],
  };
}

interface FakeInvoiceRow {
  id: number;
  orderId: number;
  shopId: number;
  type: string;
  invoiceNumber: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: string | null;
  issuedAt: Date;
}

// Simulates MySQL's `INSERT ... ON DUPLICATE KEY UPDATE lastNumber =
// LAST_INSERT_ID(lastNumber + 1)` idiom (see InvoicesService.nextInvoiceNumber)
// well enough for a unit test: the mock conn bumps a per-(shopId,type)
// counter on INSERT INTO invoicecounter and remembers which key it touched;
// the following SELECT LAST_INSERT_ID() reads that same key back —
// mirroring MySQL's session-scoped LAST_INSERT_ID() semantics closely
// enough for this purpose.
function createMockDb(opts: { createRejectsWith?: unknown } = {}) {
  const counters = new Map<string, number>();
  const invoices: FakeInvoiceRow[] = [];
  let nextId = 100;
  let lastCounterKey = '';

  interface MockConn {
    query: jest.Mock;
  }
  const conn: MockConn = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO invoicecounter')) {
        const [shopId, type] = params as [number, string];
        const key = `${shopId}:${type}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        lastCounterKey = key;
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('SELECT LAST_INSERT_ID()')) {
        return Promise.resolve([[{ seq: counters.get(lastCounterKey) ?? 0 }]]);
      }
      if (sql.includes('INSERT INTO invoice')) {
        if (opts.createRejectsWith) {
          return Promise.reject(opts.createRejectsWith);
        }
        const [orderId, shopId, type, invoiceNumber, subtotal, taxAmount, total] =
          params as [number, number, string, string, number, number, string];
        const row: FakeInvoiceRow = {
          id: nextId++,
          orderId,
          shopId,
          type,
          invoiceNumber,
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          total: String(total),
          notes: null,
          issuedAt: new Date(),
        };
        invoices.push(row);
        return Promise.resolve([{ insertId: row.id }]);
      }
      return Promise.resolve([[]]);
    }),
  };

  const db = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM invoice WHERE orderId = ? AND type = ?')) {
        const [orderId, type] = params as [number, string];
        const row = invoices.find((i) => i.orderId === orderId && i.type === type);
        return Promise.resolve(row ? [row] : []);
      }
      if (sql.includes('FROM invoice WHERE id = ?')) {
        const id = params[0] as number;
        const shopId = params.length > 1 ? (params[1] as number) : undefined;
        const row = invoices.find(
          (i) => i.id === id && (shopId === undefined || i.shopId === shopId),
        );
        return Promise.resolve(row ? [row] : []);
      }
      return Promise.resolve([]);
    }),
    transaction: jest.fn((cb: (conn: MockConn) => Promise<unknown>) => cb(conn)),
  } as unknown as DatabaseService;

  return { db, invoices };
}

describe('InvoicesService.generateForOrder', () => {
  it('creates a new invoice with subtotal/tax/total snapshotted from the order and an INV-0001-style number', async () => {
    const { db } = createMockDb();
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;

    const service = new InvoicesService(db, ordersService);
    const result = await service.generateForOrder(ctxFor(1), {
      orderId: 5,
      type: 'INVOICE',
    });

    expect(ordersService.findOne).toHaveBeenCalledWith(ctxFor(1), 5);
    expect(result).toMatchObject({
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      total: order.total,
    });
    expect(Number(result!.subtotal)).toBe(20);
  });

  it('is idempotent: a second call for the same (orderId, type) returns the existing invoice without creating a new one', async () => {
    const { db, invoices } = createMockDb();
    invoices.push({
      id: 42,
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      subtotal: '20',
      taxAmount: '1',
      total: '21',
      notes: null,
      issuedAt: new Date(),
    });
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;

    const service = new InvoicesService(db, ordersService);
    const result = await service.generateForOrder(ctxFor(1), {
      orderId: 5,
      type: 'INVOICE',
    });

    expect(result).toEqual(invoices[0]);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('invoiceNumber increments independently per shop — shop A and shop B each start at INV-0001', async () => {
    const { db } = createMockDb();
    const ordersService = {
      findOne: jest.fn((_ctx: TenantContext, orderId: number) =>
        Promise.resolve(fakeOrder({ id: orderId, shopId: _ctx.shopId })),
      ),
    } as unknown as OrdersService;
    const service = new InvoicesService(db, ordersService);

    const shopAFirst = await service.generateForOrder(ctxFor(1), {
      orderId: 1,
      type: 'INVOICE',
    });
    const shopASecond = await service.generateForOrder(ctxFor(1), {
      orderId: 2,
      type: 'INVOICE',
    });
    const shopBFirst = await service.generateForOrder(ctxFor(2), {
      orderId: 3,
      type: 'INVOICE',
    });

    expect(shopAFirst!.invoiceNumber).toBe('INV-0001');
    expect(shopASecond!.invoiceNumber).toBe('INV-0002');
    expect(shopBFirst!.invoiceNumber).toBe('INV-0001');
  });

  it('a lost race (duplicate key on the concurrent create) reads back the winner instead of throwing or duplicating', async () => {
    const { db, invoices } = createMockDb({
      createRejectsWith: duplicateKeyError(),
    });
    invoices.push({
      id: 7,
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      subtotal: '20',
      taxAmount: '1',
      total: '21',
      notes: null,
      issuedAt: new Date(),
    });
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;

    const service = new InvoicesService(db, ordersService);
    const result = await service.generateForOrder(ctxFor(1), {
      orderId: 5,
      type: 'INVOICE',
    });

    expect(result).toEqual(invoices[0]);
  });
});

describe('InvoicesService.findOne — tenant isolation', () => {
  it("never returns another shop's invoice — a mismatched shopId is a 404, not the row", async () => {
    const { db, invoices } = createMockDb();
    invoices.push({
      id: 99,
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      subtotal: '20',
      taxAmount: '1',
      total: '21',
      notes: null,
      issuedAt: new Date(),
    });
    const ordersService = {} as OrdersService;
    const service = new InvoicesService(db, ordersService);

    await expect(service.findOne(ctxFor(2), 99)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns the invoice when it does belong to the caller's shop", async () => {
    const { db, invoices } = createMockDb();
    invoices.push({
      id: 99,
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      subtotal: '20',
      taxAmount: '1',
      total: '21',
      notes: null,
      issuedAt: new Date(),
    });
    const findOne = jest.fn().mockResolvedValue({ id: 5 });
    const ordersService = { findOne } as unknown as OrdersService;
    const service = new InvoicesService(db, ordersService);

    await expect(service.findOne(ctxFor(1), 99)).resolves.toEqual(invoices[0]);
    expect(findOne).toHaveBeenCalledWith(ctxFor(1), 5);
  });

  it("also checks the underlying order's own outlet scope, not just shopId — a branch user blocked from the order is blocked from its invoice too", async () => {
    const { db, invoices } = createMockDb();
    invoices.push({
      id: 99,
      orderId: 5,
      shopId: 1,
      type: 'INVOICE',
      invoiceNumber: 'INV-0001',
      subtotal: '20',
      taxAmount: '1',
      total: '21',
      notes: null,
      issuedAt: new Date(),
    });
    const findOne = jest.fn().mockRejectedValue(new NotFoundException());
    const ordersService = { findOne } as unknown as OrdersService;
    const service = new InvoicesService(db, ordersService);

    await expect(service.findOne(ctxFor(1), 99)).rejects.toThrow(
      NotFoundException,
    );
  });
});
