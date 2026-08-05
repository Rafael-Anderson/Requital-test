import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context (request id + shopId once known), read by
// StructuredLoggerService on every log line so nothing has to thread these
// through every function call by hand. Set up once per request by
// RequestContextMiddleware; shopId is filled in later, once AuthGuard (or
// CustomerAuthGuard) has actually resolved it — see setLogContextShopId.
export interface LogContext {
  requestId: string;
  shopId?: number;
}

const als = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return als.run(context, fn);
}

export function getLogContext(): LogContext | undefined {
  return als.getStore();
}

export function setLogContextShopId(shopId: number): void {
  const ctx = als.getStore();
  if (ctx) ctx.shopId = shopId;
}
