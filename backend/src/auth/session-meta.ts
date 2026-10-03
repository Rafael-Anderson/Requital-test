import type { Request } from 'express';

// What a refresh-token row remembers about the device that created it, for the
// "active sessions" list (STF-4). Both are display-only hints supplied by the
// client/proxy: never used for an authorisation decision.
export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

// req.ip, not X-Forwarded-For: main.ts sets no `trust proxy`, so behind a
// reverse proxy this is the proxy's address until that is configured (an infra
// decision, since trusting the header lets a client choose its own IP).
export function sessionMetaFrom(req: Request): SessionMeta {
  const ua = req.headers['user-agent'];
  return {
    userAgent: ua ? ua.replace(/\p{Cc}/gu, '').slice(0, 255) : null,
    ip: req.ip ? req.ip.slice(0, 64) : null,
  };
}

export const NO_SESSION_META: SessionMeta = { userAgent: null, ip: null };
