import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { trimOrderRow } from '../database/decimal.util';
import type { CustomerRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { toSafeCustomer } from './customer-response.util';

interface CustomerListRow {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  createdAt: Date;
  orderCount: number;
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
  constructor(private readonly db: DatabaseService) {}

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
    const existingRows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
      [shopId, data.phone],
    );
    const existing = existingRows[0];
    if (existing) {
      return this.applyUpdateIfChanged(existing, data);
    }
    try {
      const result = await this.db.execute(
        `INSERT INTO customer (shopId, name, phone, email) VALUES (?, ?, ?, ?)`,
        [shopId, data.name, data.phone, data.email ?? null],
      );
      const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
        `SELECT * FROM customer WHERE id = ?`,
        [result.insertId],
      );
      return rows[0];
    } catch (error) {
      // Two concurrent orders for the same brand-new phone number can both
      // miss the SELECT above and both attempt to create — the loser hits
      // the [shopId, phone] unique constraint (the only unique constraint on
      // this table, see schema.prisma) instead of actually losing data.
      // Re-fetch and resolve to the winner's row rather than letting a 500
      // surface, running it through the same name/email-diff path an
      // ordinary (non-racing) repeat customer would take.
      if (isDuplicateKeyError(error)) {
        const winnerRows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
          `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
          [shopId, data.phone],
        );
        return this.applyUpdateIfChanged(winnerRows[0], data);
      }
      throw error;
    }
  }

  private async applyUpdateIfChanged(
    existing: CustomerRow,
    data: { name: string; email?: string | null },
  ) {
    const nameChanged = data.name && data.name !== existing.name;
    const emailChanged = data.email && data.email !== existing.email;
    if (!nameChanged && !emailChanged) {
      return existing;
    }
    const set = buildSetClause({
      name: nameChanged ? data.name : undefined,
      email: emailChanged ? data.email : undefined,
    });
    if (set) {
      await this.db.execute(`UPDATE customer SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        existing.id,
      ]);
    }
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ?`,
      [existing.id],
    );
    return rows[0];
  }

  async findAll(ctx: TenantContext, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const sortColumn = SORT_COLUMN[query.sortBy ?? 'lastOrderDate'];
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';
    const searchCondition = search ? 'AND (c.name LIKE ? OR c.phone LIKE ?)' : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.phone, c.email, c.createdAt,
              COUNT(o.id) AS orderCount,
              COALESCE(SUM(o.total), 0) AS lifetimeValue,
              MAX(o.createdAt) AS lastOrderDate
       FROM customer c
       LEFT JOIN \`order\` o ON o.customerId = c.id AND o.status != 'cancelled'
       WHERE c.shopId = ? ${searchCondition}
       GROUP BY c.id
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT ? OFFSET ?`,
      [ctx.shopId, ...searchParams, pageSize, (page - 1) * pageSize],
    );

    const totalRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM customer c WHERE c.shopId = ? ${searchCondition}`,
      [ctx.shopId, ...searchParams],
    );

    return {
      data: (rows as unknown as CustomerListRow[]).map((r) => ({
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
      total: Number(totalRows[0].total),
    };
  }

  async findOne(ctx: TenantContext, id: number) {
    const customer = await this.assertBelongsToShop(ctx, id);

    // Not outlet-scoped — customers are shop-wide (a customer isn't tied to
    // one branch), and this endpoint is admin-only anyway (see
    // customers.controller.ts), so there's no branch-outlet filter to apply.
    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE customerId = ? AND shopId = ? ORDER BY createdAt DESC`,
      [id, ctx.shopId],
    );
    const orderIds = orderRows.map((o) => o.id as number);
    const items =
      orderIds.length > 0
        ? await this.db.query<RowDataPacket[]>(
            `SELECT * FROM orderitem WHERE orderId IN (${orderIds.map(() => '?').join(', ')})`,
            orderIds,
          )
        : [];
    const itemsByOrder = new Map<number, RowDataPacket[]>();
    for (const item of items) {
      const list = itemsByOrder.get(item.orderId as number) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId as number, list);
    }
    const orders = orderRows.map((o) =>
      trimOrderRow({
        ...o,
        orderitem: (itemsByOrder.get(o.id as number) ?? []) as {
          priceAtPurchase?: unknown;
          autoDiscountAmount?: unknown;
        }[],
      }),
    ) as ({ status: string; total: string; createdAt: Date } & RowDataPacket & {
      orderitem: RowDataPacket[];
    })[];

    const completedOrders = orders.filter((o) => o.status !== 'cancelled');
    const lifetimeValue = completedOrders.reduce(
      (sum, o) => sum + Number(o.total),
      0,
    );
    const orderDates = completedOrders.map((o) => o.createdAt.getTime());

    return {
      ...toSafeCustomer(customer),
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
      const set = buildSetClause({
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
      });
      if (set) {
        await this.db.execute(`UPDATE customer SET ${set.setClause} WHERE id = ?`, [
          ...set.params,
          id,
        ]);
      }
      const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
        `SELECT * FROM customer WHERE id = ?`,
        [id],
      );
      return toSafeCustomer(rows[0]);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'Another customer with this phone number already exists',
        );
      }
      throw error;
    }
  }

  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return rows[0];
  }
}
