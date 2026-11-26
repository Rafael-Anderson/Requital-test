// Mirror by hand of backend/src/payments/credential-validation.ts (no shared
// package): the same rules, so a mistake shows under its field before the save is
// sent. The backend runs them again and is the authority (its 400 carries the same
// sentences in `fieldErrors`). Change both together.

const URL_LIKE = /^https?:\/\//i;
const HAS_WHITESPACE = /\s/;
const STRIPE_SECRET_PREFIX = /^(sk|rk)_(live|test)_/;
const STRIPE_WEBHOOK_PREFIX = /^whsec_/;

const PROVIDER_LABEL: Record<string, string> = { nomod: "Nomod", stripe: "Stripe" };
const FIELD_LABEL: Record<string, Record<string, string>> = {
  nomod: { apiKey: "API key", webhookSecret: "webhook signing secret" },
  stripe: { secretKey: "secret key", webhookSecret: "webhook secret" },
};

// Same check as the backend's decodeSecret (nomod-signature.ts): optional whsec_
// prefix, then base64 (standard or URL-safe) that decodes to at least one byte.
function decodesAsNomodSecret(value: string): boolean {
  const raw = value.replace(/^whsec_/, "");
  if (!raw || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return false;
  // Node's base64 decoder ignores characters it cannot use; a value whose usable
  // characters cannot make one byte (fewer than 2) decodes to nothing.
  const usable = raw.replace(/=+$/, "").length;
  return Math.floor((usable * 6) / 8) > 0;
}

export function credentialProblem(provider: string, field: string, rawValue: string): string | null {
  const label = FIELD_LABEL[provider]?.[field];
  if (!label) return null;
  const value = rawValue.trim();
  if (!value) return null;
  const dashboard = PROVIDER_LABEL[provider];
  if (URL_LIKE.test(value)) {
    return `This looks like a webhook URL. Paste the ${label} from your ${dashboard} dashboard instead.`;
  }
  if (HAS_WHITESPACE.test(value)) {
    return `The ${label} cannot contain spaces. Copy it again from your ${dashboard} dashboard.`;
  }
  if (provider === "nomod" && field === "webhookSecret" && !decodesAsNomodSecret(value)) {
    return "The webhook signing secret is not valid. Copy the secret (it starts with whsec_) from your Nomod dashboard.";
  }
  if (provider === "stripe" && field === "secretKey" && !STRIPE_SECRET_PREFIX.test(value)) {
    return "The secret key must start with sk_live_, sk_test_, rk_live_ or rk_test_. Copy it from your Stripe dashboard (Developers > API keys).";
  }
  if (provider === "stripe" && field === "webhookSecret" && !STRIPE_WEBHOOK_PREFIX.test(value)) {
    return "The webhook secret must start with whsec_. Copy the signing secret from your Stripe dashboard (Developers > Webhooks).";
  }
  return null;
}

export function credentialProblems(provider: string, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) {
    const p = credentialProblem(provider, field, value);
    if (p) out[field] = p;
  }
  return out;
}
