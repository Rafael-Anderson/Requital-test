// A bearer token must never reach a third party or a stored attribution record.
// Two shapes carry one: an order's tracking token as a PATH segment
// (/<shop>/orders/<token>, the confirmation page), and a `token` QUERY param
// (/orders/track?token=, /survey?token=, /cart/recover?token=, /pay?token=,
// /pay/success?token=, /account/verify-email?token=, reset links, ...). A path
// segment cannot be redacted on a provider's side, so callers either send the
// redacted string or skip the call.
//
// Works on a full URL, a path, or a path with a query/hash. Idempotent.
export const REDACTED = "[redacted]";

// /orders/<anything> except the static /orders/track page itself.
const ORDER_PATH_SEGMENT = /(\/orders\/)(?!track(?:[/?#]|$))[^/?#]+/gi;
// ?token=..., &token=... (any case), up to the next & or #.
const TOKEN_QUERY = /([?&]token=)[^&#]*/gi;

export function redactTokenUrl(input: string): string {
  if (!input) return input;
  return input.replace(ORDER_PATH_SEGMENT, `$1${REDACTED}`).replace(TOKEN_QUERY, `$1${REDACTED}`);
}

// True when redaction changes the string, i.e. it carries a token.
export function carriesToken(input: string | null | undefined): boolean {
  return !!input && redactTokenUrl(input) !== input;
}
