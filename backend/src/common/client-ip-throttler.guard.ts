import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { throttleKey } from './client-ip';
import { internalThrottleTracker } from './internal-auth';

// The stock guard keys on req.ip verbatim; this normalises it (see
// throttleKey). req.ip itself is what TRUST_PROXY governs.
//
// A request the storefront server signed with INTERNAL_API_SECRET (see
// common/internal-auth.ts) gets its own bucket instead of the shared loopback
// one. That is ALL the signature does: it never authenticates anything.
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const internal = internalThrottleTracker(
      req as Parameters<typeof internalThrottleTracker>[0],
    );
    return Promise.resolve(
      internal ?? throttleKey(req.ip as string | undefined),
    );
  }
}
