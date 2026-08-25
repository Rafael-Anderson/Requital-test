export const EXTERNAL_DELIVERY_STATUSES = [
  // Manual carrier logging (existing) — kept as-is.
  'pending',
  'picked_up',
  'delivered',
  'failed',
  // Slider's own status set (some overlap with the above by name, e.g.
  // 'picked_up'/'delivered' — reused rather than duplicated). Kept as
  // distinct values rather than collapsed onto the manual set, per the
  // Slider integration spec — return_trip_started in particular is a
  // distinct failure-ish state that needs to stay visible as itself.
  'searching_rider',
  'rider_assigned',
  'heading_to_pickup',
  'at_pickup',
  'in_transit',
  'return_trip_started',
  'cancelled',
] as const;
export type ExternalDeliveryStatus =
  (typeof EXTERNAL_DELIVERY_STATUSES)[number];
