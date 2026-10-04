import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { throttleKey } from './client-ip';

// The stock guard keys on req.ip verbatim; this normalises it (see
// throttleKey). req.ip itself is what TRUST_PROXY governs.
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(throttleKey(req.ip as string | undefined));
  }
}
