import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type customer as Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

interface CustomerListRow {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  createdAt: Date;
  orderCount: bigint;
  lifetimeValue: string | null;
  lastOrderDate: Date | null;
}

// Cancelled orders never completed — excluded from lifetime value and order
// count everywhere in this file, same convention as the dashboard's revenue
// queries (order.status != 'cancelled').
const SORT_COLUMN: Record<string, string> = {
  name: 'c.name',
  phone: 'c.phone',
  orderCount: 'orderCount',
  lifetimeValue: 'lifetimeValue',
  lastOrderDate: 'lastOrderDate',
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // Shared by both the storefront checkout flow (PublicService) and
  // admin-entered orders (OrdersService) — the one place phone-matching
  // logic lives, so the two paths can never drift apart. Matches by phone
  // within the shop (never globally); updates the saved name/email if the
  // new order's details differ, so the record stays current rather than
  // frozen at first contact.
  async findOrCreateForOrder(
    shopId: number,
    data: { name: string; phone: string; email?: string | null },
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { shopId_phone: { shopId, phone: data.phone } },
    });
    if (existing) {
      return this.applyUpdateIfChanged(existing, data);
    }
    try {
      return await this.prisma.customer.create({
        data: {
          shopId,
          name: data.name,
          phone: data.phone,
          email: data.email ?? undefined,
        },
      });
    } catch (error) {
      // Two concurrent orders for the same brand-new phone number can both
      // miss the findUnique above and both attempt to create — the loser
      // hits Customer_shopId_phone_key (the only unique constraint on this
      // table, see schema.prisma) instead of actually losing data. Re-fetch
      // and resolve to the winner's row rather than letting a 500 surface,
      // running it through the same name/email-diff path an ordinary
      // (non-racing) repeat customer would take.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.customer.findUniqueOrThrow({
          where: { shopId_phone: { shopId, phone: data.phone } },
        });
        return this.applyUpdateIfChanged(winner, data);
      }
      throw error;
    }
  }

  private async applyUpdateIfChanged(
    existing: Customer,
    data: { name: string; email?: string | null },
  ) {
    const nameChanged = data.name && data.name !== existing.name;
    const emailChanged = data.email && data.email !== existing.email;
    if (!nameChanged && !emailChanged) {
      return existing;
    }
    return this.prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(nameChanged && { name: data.name }),
        ...(emailChanged && { email: data.email }),
      },
    });
  }

  async findAll(ctx: TenantContext, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const sortColumn = SORT_COLUMN[query.sortBy ?? 'lastOrderDate'];
    const sortDir =
      query.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const searchFilter = search
      ? Prisma.sql`AND (c.name LIKE ${`%${search}%`} OR c.phone LIKE ${`%${search}%`})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<CustomerListRow[]>`
      SELECT c.id, c.name, c.phone, c.email, c.createdAt,
        COUNT(o.id) AS orderCount,
        COALESCE(SUM(o.total), 0) AS lifetimeValue,
        MAX(o.createdAt) AS lastOrderDate
      FROM customer c
      LEFT JOIN \`order\` o ON o.customerId = c.id AND o.status != 'cancelled'
      WHERE c.shopId = ${ctx.shopId}
      ${searchFilter}
      GROUP BY c.id
      ORDER BY ${Prisma.raw(sortColumn)} ${sortDir}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM customer c WHERE c.shopId = ${ctx.shopId} ${searchFilter}
    `;

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        createdAt: r.createdAt,
        orderCount: Number(r.orderCount),
        lifetimeValue: Number(r.lifetimeValue ?? 0),
        lastOrderDate: r.lastOrderDate,
      })),
      page,
      pageSize,
      total: Number(total),
    };
  }

  async findOne(ctx: TenantContext, id: number) {
    const customer = await this.assertBelongsToShop(ctx, id);

    // Not outlet-scoped — customers are shop-wide (a customer isn't tied to
    // one branch), and this endpoint is admin-only anyway (see
    // customers.controller.ts), so there's no branch-outlet filter to apply.
    const orders = await this.prisma.order.findMany({
      where: { customerId: id, shopId: ctx.shopId },
      include: { orderitem: true },
      orderBy: { createdAt: 'desc' },
    });
    const completedOrders = orders.filter((o) => o.status !== 'cancelled');
    const lifetimeValue = completedOrders.reduce(
      (sum, o) => sum + Number(o.total),
      0,
    );
    const orderDates = completedOrders.map((o) => o.createdAt.getTime());

    return {
      ...customer,
      orderCount: completedOrders.length,
      lifetimeValue,
      firstOrderDate: orderDates.length
        ? new Date(Math.min(...orderDates))
        : null,
      lastOrderDate: orderDates.length
        ? new Date(Math.max(...orderDates))
        : null,
      orders,
    };
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCustomerDto) {
    await this.assertBelongsToShop(ctx, id);
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: {
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another customer with this phone number already exists',
        );
      }
      throw error;
    }
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }
}
