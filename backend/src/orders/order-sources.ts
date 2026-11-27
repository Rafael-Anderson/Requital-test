// Where an order came from. ONE registry, mirrored by hand (same entries, same
// order) in admin/lib/order-sources.ts and storefront/lib/order-sources.ts;
// order-sources.spec.ts fails when the mirrors disagree. Adding a source (Careem,
// Noon, ...) is one entry here and in each mirror.
//
// `order.source` (migration 20261208100000) is written explicitly for new orders.
// NULL means unknown: older rows are never rewritten, their effective source is
// derived at read time by effectiveOrderSourceSql below.
//
// `tone` and `icon` are admin presentation; the backend carries them only so the
// three copies stay byte-comparable.
export const ORDER_SOURCES = [
  {
    key: 'website',
    label: 'Website',
    tag: 'Website',
    tone: 'neutral',
    icon: 'globe',
    channel: 'storefront',
  },
  {
    key: 'custom',
    label: 'Custom order',
    tag: 'Custom',
    tone: 'neutral',
    icon: 'pen',
    channel: null,
  },
  {
    key: 'talabat',
    label: 'Talabat',
    tag: 'Talabat',
    tone: 'warning',
    icon: 'store',
    channel: 'talabat',
  },
  {
    key: 'deliveroo',
    label: 'Deliveroo',
    tag: 'Deliveroo',
    tone: 'accent',
    icon: 'store',
    channel: 'deliveroo',
  },
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number]['key'];

export const ORDER_SOURCE_KEYS: readonly OrderSource[] = ORDER_SOURCES.map(
  (s) => s.key,
);

// The source of an order a marketplace delivered, or null for a provider with no
// registry entry (the test marketplace).
export function sourceForMarketplaceChannel(
  channel: string,
): OrderSource | null {
  const hit = ORDER_SOURCES.find((s) => s.key !== 'website' && s.channel === channel);
  return hit ? hit.key : null;
}

// Registry values are interpolated into SQL below as literals, so they must be
// plain identifiers. Checked once at load: a bad entry fails every test.
const SQL_SAFE = /^[a-z_]+$/;
for (const s of ORDER_SOURCES) {
  if (!SQL_SAFE.test(s.key) || (s.channel !== null && !SQL_SAFE.test(s.channel))) {
    throw new Error(`order source registry entry is not SQL-safe: ${s.key}`);
  }
}

// The effective source of an order row aliased `a`, as one SQL expression. The
// single rule for list filtering, sorting and every response:
//   1. order.source when written (every order created since the column exists);
//   2. a marketplace channel WITH a channelorder link -> that marketplace;
//   3. an admin-created order -> custom: a converted draft (adminSource,
//      draftOrderId or channel 'draft_order'), or any other non-storefront
//      channel, which only staff POST /orders ever wrote (free-text attribution
//      such as "Walk-in"; marketplace names are rejected there, so an unlinked
//      marketplace name is a hand-typed legacy value, also staff-made);
//   4. otherwise -> website (channel 'storefront', or NULL: unknown, and the
//      storefront was the only other writer).
export function effectiveOrderSourceSql(a: string): string {
  if (!/^[a-z]+$/.test(a)) throw new Error('bad alias');
  const marketplaces = ORDER_SOURCES.filter(
    (s) => s.key !== 'website' && s.channel !== null,
  )
    .map(
      (s) =>
        `WHEN ${a}.channel = '${s.channel}' AND EXISTS (SELECT 1 FROM channelorder co WHERE co.orderId = ${a}.id AND co.shopId = ${a}.shopId) THEN '${s.key}'`,
    )
    .join(' ');
  return `COALESCE(${a}.source, CASE ${marketplaces}
    WHEN ${a}.adminSource IS NOT NULL OR ${a}.draftOrderId IS NOT NULL OR ${a}.channel = 'draft_order' THEN 'custom'
    WHEN ${a}.channel IS NOT NULL AND ${a}.channel <> 'storefront' AND ${a}.channel <> 'stub_marketplace' THEN 'custom'
    ELSE 'website' END)`;
}

// ORDER BY for "sort by source": registry order, then the existing default
// (newest first), then id so equal timestamps never reorder between pages.
export function orderSourceSortSql(a: string): string {
  const keys = ORDER_SOURCE_KEYS.map((k) => `'${k}'`).join(', ');
  return `FIELD(${effectiveOrderSourceSql(a)}, ${keys}) ASC, ${a}.createdAt DESC, ${a}.id DESC`;
}
