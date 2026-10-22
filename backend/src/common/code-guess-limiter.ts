import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { FixedWindowLimiter } from '../drivers/fixed-window-limiter';
import { skipThrottling } from './throttle-env';

export const CODE_GUESS_WINDOW_MS = 15 * 60_000;
// Distinct wrong codes one client may try per shop per window.
export const CODE_GUESS_MAX_DISTINCT_FAILURES = 10;
// Repeats of the SAME wrong code from one client: they do not spend the budget
// above (retyping, or the debounced delivery quote re-sending a stale code, is
// not guessing) but are still bounded.
export const CODE_GUESS_MAX_REPEATS = 30;

// 429 that the global exception filter turns into a Retry-After header
// (it reads `retryAfterSeconds`). The body is deliberately generic: it must
// say nothing about which code, or whether any code exists.
export class CodeGuessLockedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many attempts. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// One failed-attempt limiter for every public surface that confirms or denies
// a discount or gift-card code (discount validate, delivery quote, order
// creation, gift-card validate). The per-route @Throttle buckets are per
// handler, so a guesser could spend 20 + 20 + 40 a minute across them; this one
// budget is shared by all of them and counts only FAILURES that tell a caller
// something about whether a code exists, so a shopper who types a real code
// never meets it.
//
// Keys: (shop, client IP) and (shop, client IP, code hash). NEVER the code on
// its own: that would let anyone lock a victim's real code out for everyone by
// guessing it.
//
// In-memory and per process, the same ceiling as FixedWindowLimiter and the
// Throttler (one PM2 process per app today): scaling the backend out needs a
// shared store, and until then the effective budget is N times the numbers
// above. Clients behind one NAT or proxy share a bucket (client IP is req.ip,
// i.e. what TRUST_PROXY makes it).
@Injectable()
export class CodeGuessLimiter {
  // Overridable so a unit test can move the clock.
  now: () => number = Date.now;
  private readonly perClient = new FixedWindowLimiter(
    CODE_GUESS_MAX_DISTINCT_FAILURES,
    CODE_GUESS_WINDOW_MS,
    () => this.now(),
  );
  private readonly perCode = new FixedWindowLimiter(
    CODE_GUESS_MAX_REPEATS,
    CODE_GUESS_WINDOW_MS,
    () => this.now(),
  );

  private keys(shopId: number, ip: string | undefined, code: string) {
    const client = `${shopId}|${ip ?? 'unknown'}`;
    const hash = createHash('sha256')
      .update(code.trim().toUpperCase())
      .digest('hex')
      .slice(0, 32);
    return { client, code: `${client}|${hash}` };
  }

  // Throws once the client has used up its budget. Does not count.
  assertAllowed(shopId: number, ip: string | undefined, code: string): void {
    if (skipThrottling()) return;
    const k = this.keys(shopId, ip, code);
    const a = this.perClient.peek(k.client);
    const b = this.perCode.peek(k.code);
    const lockedMs = Math.max(
      a.count >= CODE_GUESS_MAX_DISTINCT_FAILURES ? a.retryAfterMs : 0,
      b.count >= CODE_GUESS_MAX_REPEATS ? b.retryAfterMs : 0,
    );
    if (lockedMs > 0) {
      throw new CodeGuessLockedException(Math.max(1, Math.ceil(lockedMs / 1000)));
    }
  }

  recordFailure(shopId: number, ip: string | undefined, code: string): void {
    if (skipThrottling()) return;
    const k = this.keys(shopId, ip, code);
    const first = this.perCode.peek(k.code).count === 0;
    this.perCode.hit(k.code);
    if (first) this.perClient.hit(k.client);
  }
}
