export const EXTERNAL_DELIVERY_STATUSES = ['pending', 'picked_up', 'delivered', 'failed'] as const;
export type ExternalDeliveryStatus = (typeof EXTERNAL_DELIVERY_STATUSES)[number];
