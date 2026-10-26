import { createHash } from 'crypto';
import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PROVIDER_CALL_TIMEOUT_MS } from '../payments/payment-provider.interface';

// F8. Shapes shared by the storefront checkout's idempotency and its gateway
// failure path.

// What the shopper is told when the order could not be handed to the payment
// gateway. Deliberately says nothing about the gateway, its error, a key or an id:
// the cause is logged server side (and 5xx reaches error tracking). The `code` lets
// the storefront tell this from a validation error (it starts a fresh attempt).
// An object body, never a bare string: AllExceptionsFilter ships getResponse()
// verbatim, so a string would reach the client without a `message`.
export const PAYMENT_UNAVAILABLE_CODE = 'payment_unavailable';
// The order was KEPT (it already has a live payment session the shopper may still
// pay, or it moved on): the attempt is not over, so the storefront keeps its key.
export const PAYMENT_RETRY_CODE = 'payment_session_unavailable';
export const SESSION_IN_PROGRESS_CODE = 'payment_session_in_progress';

export class PaymentUnavailableException extends ServiceUnavailableException {
  // cancelled = the order was cancelled and everything given back, so the message
  // may say nothing was placed or charged. Otherwise the order still exists, and
  // the message claims nothing about it.
  constructor(cancelled = true) {
    super(
      cancelled
        ? {
            statusCode: 503,
            code: PAYMENT_UNAVAILABLE_CODE,
            message:
              'We could not start your online payment. Your order was not placed and you have not been charged. Please try again, or choose another payment method.',
          }
        : {
            statusCode: 503,
            code: PAYMENT_RETRY_CODE,
            message:
              'We could not start your online payment right now. Please wait a moment and try again.',
          },
    );
  }
}

// Another request holds the lease on this order's gateway session (it is being
// created right now). 409, never a second session.
export class SessionInProgressException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: SESSION_IN_PROGRESS_CODE,
      message:
        'Your payment is being prepared. Please wait a moment and try again.',
    });
  }
}

// Thrown inside the session step when the order stopped being pending and unpaid
// (paid, cancelled or confirmed meanwhile). The caller reports the order's actual
// state instead of "not charged".
export class OrderNotPayableError extends Error {}

// The gateway did not answer within the allowed time (see providerTimeoutMs).
export class ProviderTimeoutError extends Error {
  constructor() {
    super('payment gateway call timed out');
  }
}

// What is safe to log about a failed provider call: its class, an HTTP status and
// the provider's own error code, all bounded. Never the message: a gateway error
// message can carry a partial key, a request id or an account detail.
export function describeProviderError(err: unknown): {
  errorClass: string;
  status?: number;
  providerCode?: string;
} {
  if (!(err instanceof Error)) return { errorClass: 'non-error' };
  const anyErr = err as Error & {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    raw?: { code?: unknown };
  };
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 64) : undefined;
  return {
    errorClass: err.constructor.name.slice(0, 64),
    status:
      err instanceof HttpException
        ? err.getStatus()
        : (num(anyErr.statusCode) ?? num(anyErr.status)),
    providerCode: str(anyErr.code) ?? str(anyErr.raw?.code),
  };
}

// Fields that do not describe WHAT is being ordered and so must not make the same
// attempt look like a different one: the key itself, and the marketing attribution
// blob (a fresh consent state or click id between two submits is not a new order).
const EXCLUDED = new Set(['idempotencyKey', 'attribution']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

// SHA-256 over the canonical request (sorted keys, undefined and null dropped, so
// an omitted field and an explicit null agree) plus the logged-in customer when
// there is one (store credit belongs to that account). Stored on the order next to
// the key: the same key with a different fingerprint is a client bug or an attack,
// answered 409, never silently served the first order.
export function checkoutFingerprint(
  dto: object,
  sessionCustomerId: number | null,
): string {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto)) {
    if (!EXCLUDED.has(k)) body[k] = v;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical({ body, sessionCustomerId })))
    .digest('hex');
}

// The longest one gateway create-session call may take. Far below the session lease,
// so a hung call is abandoned (and its lease released) long before the lease
// lapses. PAYMENT_PROVIDER_TIMEOUT_MS overrides it (100 ms to 60 s) ONLY when
// NODE_ENV is "test"; production always uses the default.
export function providerTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  if (env.NODE_ENV !== 'test') return PROVIDER_CALL_TIMEOUT_MS;
  const raw = Number(env.PAYMENT_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 100 && raw <= 60_000
    ? raw
    : PROVIDER_CALL_TIMEOUT_MS;
}
