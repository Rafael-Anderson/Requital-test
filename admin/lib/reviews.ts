import type { ReviewItem } from "@/lib/types";

export function consentLabel(consent: number | null): string {
  if (consent === 1) return "Agreed to publish";
  if (consent === 0) return "Did not agree to publish";
  return "No consent recorded";
}

// Why the "Show on store" switch is off for a row, or null when it is usable.
export function disabledReason(r: Pick<ReviewItem, "publishConsent" | "canFeature">): string | null {
  if (r.canFeature) return null;
  if (r.publishConsent !== 1) {
    return "The customer did not agree to publish this feedback, so it cannot be shown on your store.";
  }
  return "There is no written comment to show.";
}
