// Marketplace channel contract (E1). Everything a marketplace provider
// (Deliveroo, Talabat, the deterministic stub) has to implement, and the single
// canonical shape the ingestion core works on. Providers translate; the core
// never sees a vendor payload. See docs/plans/marketplace-channels.md.

// ---------------------------------------------------------------------------
// Canonical order. Money is INTEGER MINOR UNITS in `currency` (KWD/BHD/OMR have
// three decimals: minorUnitFactor). A figure the marketplace did not state is
// `null` - NEVER 0 and never derived: unknown tax, unknown commission and an
// unknown delivery fee must stay unknown all the way to the database.
// ---------------------------------------------------------------------------

// Who gets the goods to the customer. Decides order.orderType:
//   marketplace_courier, customer_pickup -> 'pickup'   (the merchant does not
//       deliver, so the order must never reach the driver-dispatch lists)
//   merchant_delivery                    -> 'delivery'
export type ChannelHandover =
  'marketplace_courier' | 'merchant_delivery' | 'customer_pickup';

export interface CanonicalChannelLine {
  // The id the marketplace uses for the item (Deliveroo pos_item_id, Talabat
  // sku). Stable ids are what make a mapping durable.
  externalItemId: string;
  name: string;
  quantity: number;
  // Price per unit as charged to the customer, modifiers folded in, BEFORE any
  // discount. The order line stores exactly this: what the aggregator charged.
  unitPriceMinor: number;
  // Total discount on the whole line (all units), if the payload states one.
  discountMinor: number | null;
  // Tax on the whole line, only if the payload states it.
  taxMinor: number | null;
  // Modifier / instruction text, shown on the order line.
  note: string | null;
}

export interface CanonicalChannelTotals {
  subtotalMinor: number | null;
  deliveryFeeMinor: number | null;
  discountMinor: number | null;
  taxMinor: number | null;
  // What the marketplace takes. NULL = not in the payload (Deliveroo's order
  // schema carries none: VERIFIED in the plan doc).
  commissionMinor: number | null;
  // What the customer paid for the order, as the marketplace states it.
  totalMinor: number;
  // Cash the customer still owes on delivery (0 / null = nothing).
  cashDueMinor: number | null;
}

// Personal data is the exception, not the rule. A field the marketplace does not
// send stays null and the order stores ''.
export interface CanonicalChannelCustomer {
  name: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export interface CanonicalChannelOrder {
  externalOrderId: string;
  // The human-facing number the kitchen and rider read out.
  displayId: string | null;
  // The marketplace's own status for this order ('placed', 'accepted', ...).
  externalStatus: string;
  placedAt: string | null;
  // The marketplace's own deadline to accept before it auto-rejects.
  acceptBy: string | null;
  // Scheduled / pre-orders: when the kitchen should start.
  scheduledFor: string | null;
  currency: string;
  handover: ChannelHandover;
  lines: CanonicalChannelLine[];
  totals: CanonicalChannelTotals;
  customer: CanonicalChannelCustomer;
}

// What the marketplace says happened to an order, normalised. `other` keeps the
// vendor's own word in `externalStatus` for display.
export type CanonicalOrderStatus =
  | 'placed'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'other';

export type ParsedChannelEvent =
  | { kind: 'order_new'; order: CanonicalChannelOrder }
  | {
      kind: 'order_status';
      externalOrderId: string;
      status: CanonicalOrderStatus;
      externalStatus: string;
      // Present when the event carries the whole order (lets a status event
      // that arrives before `order.new` still create the order).
      order?: CanonicalChannelOrder;
    }
  | { kind: 'ignored'; reason: string };

// A verified payload that cannot be understood. Deterministic: retrying will
// not help, so the inbox row goes straight to `dead` for a human / a code fix.
export class ChannelParseError extends Error {}

// ---------------------------------------------------------------------------
// Capabilities: the union of what Deliveroo and Talabat document. A provider
// sets only the ones it really implements; every outbound method is optional
// and the core checks the flag before calling.
// ---------------------------------------------------------------------------
export interface ChannelCapabilities {
  acceptReject: boolean;
  substituteItems: boolean;
  removeItem: boolean;
  markReady: boolean;
  itemAvailability: boolean;
  branchStatus: boolean;
  catalogueSync: boolean;
  prepTimeAdjust: boolean;
  fetchOrderStatus: boolean;
  // listOpenOrders: the polling fallback for a webhook outage.
  pollOrders: boolean;
  // Talabat Golden tier.
  callbackUrls: boolean;
  asyncDispatch: boolean;
  orderStatusEvents: boolean;
  // testConnection() PROVES the stored credentials can see the stored location
  // id. Enabling a connection is refused for a provider that cannot, because the
  // location id is the only tenant discriminator when the webhook secret is
  // shared (see the plan doc, "Tenant routing").
  provesLocationOwnership: boolean;
  // The webhook secret is a platform-level value (env), not per connection.
  platformWebhookSecret: boolean;
}

export const NO_CAPABILITIES: ChannelCapabilities = {
  acceptReject: false,
  substituteItems: false,
  removeItem: false,
  markReady: false,
  itemAvailability: false,
  branchStatus: false,
  catalogueSync: false,
  prepTimeAdjust: false,
  fetchOrderStatus: false,
  pollOrders: false,
  callbackUrls: false,
  asyncDispatch: false,
  orderStatusEvents: false,
  provesLocationOwnership: false,
  platformWebhookSecret: false,
};

// A connection with its secrets decrypted, for the duration of one provider
// call. Built by ChannelConnectionsService.bind(); never logged, never returned
// by an API, never put in a job payload.
export interface BoundChannelConnection {
  id: number;
  shopId: number;
  outletId: number;
  provider: string;
  externalLocationId: string | null;
  externalBrandId: string | null;
  externalSiteId: string | null;
  credentials: Record<string, string> | null;
  webhookSecret: string | null;
}

export interface VerifyWebhookInput {
  rawBody: Buffer;
  // Lower-cased header names.
  headers: Record<string, string | string[] | undefined>;
  // Candidate secrets: the connection's own, then the platform's if the
  // provider says it uses one. Compared in constant time.
  secrets: string[];
}

export interface VerifyWebhookResult {
  valid: boolean;
  // The delivery's unique id (Deliveroo sequence GUID, a Talabat delivery id).
  // NULL = derive from the body hash.
  eventId: string | null;
}

export interface ProviderCallResult {
  ok: boolean;
  // Safe, short, no secrets. Shown to the merchant.
  message?: string;
}

// One write-only field of a provider's credential form, so the merchant UI draws
// the form the provider really needs instead of guessing key names. Labels are
// merchant-facing copy; `key` is what the provider reads out of `credentials`.
export interface ChannelCredentialField {
  key: string;
  label: string;
}

export interface ChannelProvider {
  readonly name: string;
  // Merchant-facing name ('Deliveroo'); the admin falls back to `name`.
  readonly displayName?: string;
  readonly credentialFields?: ChannelCredentialField[];
  readonly capabilities: ChannelCapabilities;

  // --- inbound -------------------------------------------------------------
  // Reads the location / vendor id out of an UNAUTHENTICATED body, only to pick
  // the candidate connection. Nothing in the result is trusted before
  // verifyWebhook() passes against that connection's secret.
  extractRoutingKey(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): string | null;
  verifyWebhook(input: VerifyWebhookInput): VerifyWebhookResult;
  // Pure. Throws ChannelParseError for a payload it cannot understand.
  parseEvent(payload: unknown): ParsedChannelEvent;
  // Only for providers whose capabilities.platformWebhookSecret is true: the
  // platform-level secret(s) read from the environment (never stored, never
  // logged). Tried after the connection's own secret.
  platformWebhookSecrets?(): string[];

  // --- outbound (each optional; guarded by capabilities) -------------------
  testConnection?(
    conn: BoundChannelConnection,
  ): Promise<ProviderCallResult & { provesLocation: boolean }>;
  acceptOrder?(
    conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<ProviderCallResult>;
  rejectOrder?(
    conn: BoundChannelConnection,
    externalOrderId: string,
    reason: string,
  ): Promise<ProviderCallResult>;
  substituteItem?(
    conn: BoundChannelConnection,
    externalOrderId: string,
    externalItemId: string,
    replacementExternalItemId: string,
  ): Promise<ProviderCallResult>;
  removeItem?(
    conn: BoundChannelConnection,
    externalOrderId: string,
    externalItemId: string,
  ): Promise<ProviderCallResult>;
  // "Food is ready" / ready for collection.
  markReady?(
    conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<ProviderCallResult>;
  setItemAvailability?(
    conn: BoundChannelConnection,
    items: { externalItemId: string; available: boolean }[],
  ): Promise<ProviderCallResult>;
  setBranchStatus?(
    conn: BoundChannelConnection,
    status: 'open' | 'closed' | 'busy',
    until?: Date,
  ): Promise<ProviderCallResult>;
  // Menu / catalogue push. Item ids MUST be stable across pushes.
  pushCatalogue?(
    conn: BoundChannelConnection,
    items: {
      externalItemId: string;
      name: string;
      priceMinor: number;
      currency: string;
      available: boolean;
    }[],
  ): Promise<ProviderCallResult>;
  adjustPrepTime?(
    conn: BoundChannelConnection,
    minutes: number,
  ): Promise<ProviderCallResult>;
  fetchOrderStatus?(
    conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<{ status: CanonicalOrderStatus; externalStatus: string } | null>;
  // Polling fallback: the open (not yet final) orders the marketplace holds for
  // this location, as the same raw payload shape parseEvent() accepts.
  listOpenOrders?(
    conn: BoundChannelConnection,
  ): Promise<{ eventId: string; payload: unknown }[]>;
}

// Order channels. `order.channel` and `order.paymentMethod` carry the provider
// name for a marketplace order (the marketplace collected the money).
export const CHANNEL_ORDER_STATES = [
  // Waiting for item mappings. No `order` row yet (orderitem.productId is NOT
  // NULL), but the order is listed and alerted and its deadline is running.
  'needs_mapping',
  // The order exists, stock is held, the merchant has to accept before acceptBy.
  'pending_acceptance',
  'accepted',
  'rejected',
  'cancelled_upstream',
] as const;
export type ChannelOrderState = (typeof CHANNEL_ORDER_STATES)[number];
