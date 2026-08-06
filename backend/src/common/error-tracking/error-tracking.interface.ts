// Deliberately vendor-agnostic — no Sentry/Bugsnag/etc. types leak in here,
// same "interface + real impl + non-blocking stub" strategy-pattern
// PaymentProvider/EmailProvider already use in this codebase. A real vendor
// SDK can implement this interface later without any caller (the exception
// filter) ever needing to change.
export interface ErrorContext {
  requestId?: string;
  shopId?: number;
  route?: string;
  method?: string;
  // Deliberately no request body field — captured error context must never
  // include it, since a body can carry a password/token/payment field. The
  // interface shape itself is the guard: there's nowhere to put it.
}

export interface ErrorTrackingProvider {
  captureException(error: unknown, context: ErrorContext): void;
}
