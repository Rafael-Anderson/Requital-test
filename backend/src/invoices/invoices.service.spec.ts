import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import type { OrdersService } from '../orders/orders.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function ctxFor(shopId: number): TenantContext {
  return { userId: 1, shopId, role: 'admin', outletId: null };
}

function fakeOrder(overrides: Partial<{ id: number; shopId: number }> = {}) {
  return {
    id: overrides.id ?? 1,
    shopId: overrides.shopId ?? 1,
    total: new Prisma.Decimal(21),
    taxAmount: new Prisma.Decimal(1),
    orderitem: [
      { priceAtPurchase: new Prisma.Decimal(10), quantity: 2 },
    ],
  };
}

// Simulates MySQL's `INSERT ... ON DUPLICATE KEY UPDATE lastNumber =
// LAST_INSERT_ID(lastNumber + 1)` idiom (see InvoicesService.nextInvoiceNumber)
// well enough for a unit test: $executeRaw bumps a per-(shopId,type) counter
// and remembers which key it touched; $queryRaw's SELECT LAST_INSERT_ID()
// reads that same key back — mirroring MySQL's session-scoped
// LAST_INSERT_ID() semantics closely enough for this purpose.
function createMockPrisma() {
  const counters = new Map<string, number>();
  let lastKey = '';
  const tx = {
    $executeRaw: jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [shopId, type] = values as [number, string];
      const key = `${shopId}:${type}`;
      lastKey = key;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return Promise.resolve(1);
    }),
    $queryRaw: jest.fn(() =>
      Promise.resolve([{ seq: BigInt(counters.get(lastKey) ?? 0) }]),
    ),
    invoice: { create: jest.fn() },
  };
  return {
    invoice: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    order: { findFirstOrThrow: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaService & { __tx: typeof tx };
}

describe('InvoicesService.generateForOrder', () => {
  it('creates a new invoice with subtotal/tax/total snapshotted from the order and an INV-0001-style number', async () => {
    const prisma = createMockPrisma();
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;
    prisma.invoice.findUnique = jest.fn().mockResolvedValue(null);
    (prisma as unknown as { __tx: { invoice: { create: jest.Mock } } }).__tx.invoice.create.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: 100, ...args.data }),
    );

    const service = new InvoicesService(prisma, ordersService);
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
      subtotal: expect.any(Prisma.Decimal),
      total: order.total,
    });
    expect((result as { subtotal: Prisma.Decimal }).subtotal.toNumber()).toBe(20);
  });

  it('is idempotent: a second call for the same (orderId, type) returns the existing invoice without creating a new one', async () => {
    const prisma = createMockPrisma();
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;
    const existing = { id: 42, orderId: 5, type: 'INVOICE', invoiceNumber: 'INV-0001' };
    prisma.invoice.findUnique = jest.fn().mockResolvedValue(existing);

    const service = new InvoicesService(prisma, ordersService);
    const result = await service.generateForOrder(ctxFor(1), {
      orderId: 5,
      type: 'INVOICE',
    });

    expect(result).toBe(existing);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('invoiceNumber increments independently per shop — shop A and shop B each start at INV-0001', async () => {
    const prisma = createMockPrisma();
    prisma.invoice.findUnique = jest.fn().mockResolvedValue(null);
    (prisma as unknown as { __tx: { invoice: { create: jest.Mock } } }).__tx.invoice.create.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: Math.random(), ...args.data }),
    );
    const ordersService = {
      findOne: jest.fn((_ctx: TenantContext, orderId: number) =>
        Promise.resolve(fakeOrder({ id: orderId, shopId: _ctx.shopId })),
      ),
    } as unknown as OrdersService;
    const service = new InvoicesService(prisma, ordersService);

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

    expect((shopAFirst as { invoiceNumber: string }).invoiceNumber).toBe('INV-0001');
    expect((shopASecond as { invoiceNumber: string }).invoiceNumber).toBe('INV-0002');
    expect((shopBFirst as { invoiceNumber: string }).invoiceNumber).toBe('INV-0001');
  });

  it('a lost race (P2002 on the concurrent create) reads back the winner instead of throwing or duplicating', async () => {
    const prisma = createMockPrisma();
    const order = fakeOrder({ id: 5, shopId: 1 });
    const ordersService = {
      findOne: jest.fn().mockResolvedValue(order),
    } as unknown as OrdersService;
    prisma.invoice.findUnique = jest
      .fn()
      // First check inside generateForOrder: no existing invoice yet.
      .mockResolvedValueOnce(null)
      // Re-check after losing the race: the concurrent winner's row.
      .mockResolvedValueOnce({ id: 7, orderId: 5, type: 'INVOICE', invoiceNumber: 'INV-0001' });
    (prisma as unknown as { __tx: { invoice: { create: jest.Mock } } }).__tx.invoice.create.mockRejectedValue(
      p2002(),
    );

    const service = new InvoicesService(prisma, ordersService);
    const result = await service.generateForOrder(ctxFor(1), {
      orderId: 5,
      type: 'INVOICE',
    });

    expect(result).toEqual({ id: 7, orderId: 5, type: 'INVOICE', invoiceNumber: 'INV-0001' });
  });
});

describe('InvoicesService.findOne — tenant isolation', () => {
  it('never returns another shop\'s invoice — a mismatched shopId is a 404, not the row', async () => {
    const prisma = createMockPrisma();
    prisma.invoice.findFirst = jest.fn().mockResolvedValue(null);
    const ordersService = {} as OrdersService;
    const service = new InvoicesService(prisma, ordersService);

    await expect(service.findOne(ctxFor(2), 99)).rejects.toThrow(NotFoundException);
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: 99, shopId: 2 },
    });
  });

  it('returns the invoice when it does belong to the caller\'s shop', async () => {
    const prisma = createMockPrisma();
    const invoice = { id: 99, orderId: 5, shopId: 1, type: 'INVOICE', invoiceNumber: 'INV-0001' };
    prisma.invoice.findFirst = jest.fn().mockResolvedValue(invoice);
    const ordersService = {} as OrdersService;
    const service = new InvoicesService(prisma, ordersService);

    await expect(service.findOne(ctxFor(1), 99)).resolves.toBe(invoice);
  });
});
