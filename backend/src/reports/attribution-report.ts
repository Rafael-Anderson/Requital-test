import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService, QueryParam } from '../database/database.service';

// MKT-14's report query, shared by GET /reports/attribution and the ANL-11 CSV
// export so the two can never disagree about what a "source" is.
//
// What counts as an order here:
//   - not cancelled (the Dashboard / Product Sales convention), and
//   - not an ONLINE-payment order that was never paid. A card/BNPL order that
//     stays 'unpaid' is an abandoned checkout, not a conversion, and counting its
//     value would make every paid channel look better than it is. Pay-on-delivery
//     and pickup orders count from creation (they have no payment event), which
//     is the same moment the ad-platform conversion is reported.
//
// Grouped by the order's OWN currency as well as source/medium/campaign: one shop
// can legitimately hold orders in several currencies over its life (A6), and a
// SUM across currencies is meaningless. Each row therefore has exactly one
// currency and is rendered with it.
//
// `model` picks which touch is attributed: the last touch (default; who got the
// sale) or the first touch (who introduced the customer). The JSON path is chosen
// from a closed pair here, never interpolated from input.
export type AttributionModel = 'first' | 'last';

export const ONLINE_PAYMENT_METHODS = ['card_online', 'paypal', 'tabby', 'tamara'];

export interface AttributionFilters {
  shopId: number;
  outletId?: number;
  dateFrom?: string;
  dateTo?: string;
  model?: AttributionModel;
}

export interface AttributionRow {
  source: string;
  medium: string;
  campaign: string;
  currency: string;
  orders: number;
  // Sum of order.total in `currency`, full precision; the caller rounds once
  // with that currency's own minor unit.
  revenue: number;
}

export async function queryAttributionRows(
  db: DatabaseService,
  filters: AttributionFilters,
  limit: number,
  offset: number,
): Promise<AttributionRow[]> {
  const touch = filters.model === 'first' ? '$.firstTouch' : '$.lastTouch';
  const conditions = [
    'o.shopId = ?',
    `o.status <> 'cancelled'`,
    `NOT (o.paymentStatus = 'unpaid' AND o.paymentMethod IN (${ONLINE_PAYMENT_METHODS.map(() => '?').join(', ')}))`,
  ];
  const params: QueryParam[] = [filters.shopId, ...ONLINE_PAYMENT_METHODS];
  if (filters.outletId !== undefined) {
    conditions.push('o.outletId = ?');
    params.push(filters.outletId);
  }
  if (filters.dateFrom) {
    conditions.push('o.createdAt >= ?');
    params.push(new Date(filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push('o.createdAt <= ?');
    params.push(new Date(filters.dateTo));
  }

  const rows = await db.query<RowDataPacket[]>(
    `SELECT source, medium, campaign, currency,
            COUNT(*) AS orders, SUM(total) AS revenue
       FROM (
         SELECT COALESCE(o.attributionJson->>'${touch}.source', '(unknown)') AS source,
                COALESCE(o.attributionJson->>'${touch}.medium', '(unknown)') AS medium,
                COALESCE(o.attributionJson->>'${touch}.campaign', '(not set)') AS campaign,
                o.currency AS currency,
                o.total AS total
           FROM \`order\` o
          WHERE ${conditions.join(' AND ')}
       ) t
      GROUP BY source, medium, campaign, currency
      ORDER BY orders DESC, source, medium, campaign, currency
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map((r) => ({
    source: r.source as string,
    medium: r.medium as string,
    campaign: r.campaign as string,
    currency: r.currency as string,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
  }));
}
