import type { PolicyPageType } from "@/lib/types";

// URL segment -> PolicyPageType — mirrors components/Footer.tsx's
// POLICY_URL_SLUGS by hand (the reverse direction of that same map). Shared by
// the policy page and its server layout (which decides the HTTP status).
export const POLICY_SLUG_TO_TYPE: Record<string, PolicyPageType> = {
  terms: "TERMS",
  privacy: "PRIVACY",
  refund: "REFUND",
  payment: "PAYMENT",
  shipping: "SHIPPING",
};
