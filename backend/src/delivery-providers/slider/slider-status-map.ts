import { EXTERNAL_DELIVERY_STATUSES } from '../../external-deliveries/constants';
import type { ExternalDeliveryStatus } from '../../external-deliveries/constants';

// Slider's 9 statuses are all already first-class values in
// EXTERNAL_DELIVERY_STATUSES (see that file's own comment) — no collapsing,
// per the integration spec. This just guards against Slider ever sending a
// value we don't recognize (a future status this codebase hasn't been
// taught yet) rather than writing an arbitrary string into a column other
// code pattern-matches on.
export function mapSliderStatus(raw: string): ExternalDeliveryStatus {
  if ((EXTERNAL_DELIVERY_STATUSES as readonly string[]).includes(raw)) {
    return raw as ExternalDeliveryStatus;
  }
  return 'pending';
}
