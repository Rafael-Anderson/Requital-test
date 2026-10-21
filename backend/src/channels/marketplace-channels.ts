// The values `order.channel` takes for an order that arrived from a marketplace.
// Pure and dependency-free on purpose: orders/constants.ts, the notification
// service and the payments service all need to ask "is this a marketplace
// order?" and none of them should import the channels module to do it.
//
// 'stub_marketplace' is the deterministic test provider (never registered in
// production, see ChannelProviderRegistry).
export const MARKETPLACE_ORDER_CHANNELS = [
  'deliveroo',
  'talabat',
  'stub_marketplace',
] as const;

export function isMarketplaceChannel(
  channel: string | null | undefined,
): boolean {
  return (
    typeof channel === 'string' &&
    (MARKETPLACE_ORDER_CHANNELS as readonly string[]).includes(channel)
  );
}

// For INPUT validation: the same test, but forgiving about case and padding, so
// "Deliveroo " and "DELIVEROO" cannot be typed into a hand-made order either.
export function isMarketplaceChannelValue(
  channel: string | null | undefined,
): boolean {
  return (
    typeof channel === 'string' &&
    (MARKETPLACE_ORDER_CHANNELS as readonly string[]).includes(
      channel.trim().toLowerCase(),
    )
  );
}
