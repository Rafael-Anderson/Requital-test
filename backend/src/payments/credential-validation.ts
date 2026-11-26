import { decodeSecret } from './nomod/nomod-signature';

// Shape checks for card-processor credentials, run when a merchant saves them.
// They catch the mistakes that are certain to fail (a webhook URL pasted into a
// key field, a value with spaces, the wrong kind of key) with a message naming
// the field. Nothing here proves a key WORKS: that is the Test connection call.
// Leading and trailing whitespace is trimmed before checking (copy and paste adds
// it); whitespace INSIDE a value is rejected.
//
// Returns the first problem as a merchant-facing sentence, or null when the value
// is acceptable. Blank values are not judged here (the caller decides whether a
// field may be blank).

const URL_LIKE = /^https?:\/\//i;
const HAS_WHITESPACE = /\s/;

export type ValidatedProvider = 'nomod' | 'stripe';

const PROVIDER_LABEL: Record<ValidatedProvider, string> = {
  nomod: 'Nomod',
  stripe: 'Stripe',
};

const FIELD_LABEL: Record<ValidatedProvider, Record<string, string>> = {
  nomod: { apiKey: 'API key', webhookSecret: 'webhook signing secret' },
  stripe: { secretKey: 'secret key', webhookSecret: 'webhook secret' },
};

function common(
  provider: ValidatedProvider,
  field: string,
  value: string,
): string | null {
  const label = FIELD_LABEL[provider][field];
  const dashboard = PROVIDER_LABEL[provider];
  if (URL_LIKE.test(value)) {
    return `This looks like a webhook URL. Paste the ${label} from your ${dashboard} dashboard instead.`;
  }
  if (HAS_WHITESPACE.test(value)) {
    return `The ${label} cannot contain spaces. Copy it again from your ${dashboard} dashboard.`;
  }
  return null;
}

const STRIPE_SECRET_PREFIX = /^(sk|rk)_(live|test)_/;
const STRIPE_WEBHOOK_PREFIX = /^whsec_/;

export function credentialProblem(
  provider: string,
  field: string,
  rawValue: string,
): string | null {
  if (provider !== 'nomod' && provider !== 'stripe') return null;
  if (!(field in FIELD_LABEL[provider])) return null;
  const value = rawValue.trim();
  if (!value) return null;
  const basic = common(provider, field, value);
  if (basic) return basic;

  if (provider === 'nomod' && field === 'webhookSecret') {
    if (!decodeSecret(value)) {
      return 'The webhook signing secret is not valid. Copy the secret (it starts with whsec_) from your Nomod dashboard.';
    }
  }
  if (provider === 'stripe' && field === 'secretKey') {
    if (!STRIPE_SECRET_PREFIX.test(value)) {
      return 'The secret key must start with sk_live_, sk_test_, rk_live_ or rk_test_. Copy it from your Stripe dashboard (Developers > API keys).';
    }
  }
  if (provider === 'stripe' && field === 'webhookSecret') {
    if (!STRIPE_WEBHOOK_PREFIX.test(value)) {
      return 'The webhook secret must start with whsec_. Copy the signing secret from your Stripe dashboard (Developers > Webhooks).';
    }
  }
  return null;
}

// Every problem in a credentials object, keyed by field. Empty when all is well.
export function credentialProblems(
  provider: string,
  credentials: Record<string, unknown>,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const [field, value] of Object.entries(credentials)) {
    if (typeof value !== 'string') continue;
    const problem = credentialProblem(provider, field, value);
    if (problem) problems[field] = problem;
  }
  return problems;
}
