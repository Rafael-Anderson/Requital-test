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

export const CODE_GUESS_LOCKED_MESSAGE =
  'Too many attempts. Please try again later.';

// 429 that the global exception filter turns into a Retry-After header
// (it reads `retryAfterSeconds`). The body is deliberately generic: it must
// say nothing about which code, or whether any code exists.
export class CodeGuessLockedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: CODE_GUESS_LOCKED_MESSAGE,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// Handed back by reserve(): call refund() once the lookup shows the attempt was
// NOT an existence-revealing failure (a valid code, a specific post-existence
// rejection, or an error). Idempotent.
export interface CodeGuessTicket {
  refund(): void;
}
const NOOP_TICKET: CodeGuessTicket = { refund() {} };

// One failed-attempt limiter for every public surface that confirms or denies
// a discount or gift-card code (discount validate, delivery quote, order
// creation, gift-card validate). The per-route @Throttle buckets are per
// handler, so a guesser could spend 20 + 20 + 40 a minute across them; this one
// budget is shared by all of them, so a shopper who types a real code never
// meets it.
//
// RESERVE, THEN LOOK UP. The attempt is counted (synchronously, before any
// await) the moment it starts and refunded when it turns out not to have been a
// failure that tells the caller whether a code exists. Counting only after the
// lookup left a gap of several awaited DB round trips in which a parallel burst
// could all pass the check, so the budget is now a hard bound on how many
// distinct codes reach the lookup, however the requests are interleaved.
//
// Keys: (shop, client IP) and (shop, client IP, code hash). NEVER the code on
// its own: that would let anyone lock a victim's real code out for everyone by
// guessing it. The client budget counts DISTINCT codes: repeats of one code
// (retyping, or the debounced delivery quote re-sending a stale code) only
// spend the per-code allowance.
//
// In-memory and per process, the same ceiling as FixedWindowLimiter and the
// Throttler (one PM2 process per app today): scaling the backend out needs a
// shared store, and until then the effective budget is N times the numbers
// above. Clients behind one NAT or proxy share a bucket (client IP is req.ip,
// i.e. what TRUST_PROXY makes it; production sets TRUST_PROXY=loopback).
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

  // Counts this attempt, or throws 429 when the client's budget is spent. Must
  // be called before the lookup it guards, with no await in between.
  reserve(
    shopId: number,
    ip: string | undefined,
    code: string,
  ): CodeGuessTicket {
    if (skipThrottling()) return NOOP_TICKET;
    const k = this.keys(shopId, ip, code);
    const code0 = this.perCode.peek(k.code);
    const client = this.perClient.peek(k.client);
    const isNewCode = code0.count === 0;
    const lockedMs = Math.max(
      isNewCode && client.count >= CODE_GUESS_MAX_DISTINCT_FAILURES
        ? client.retryAfterMs
        : 0,
      code0.count >= CODE_GUESS_MAX_REPEATS ? code0.retryAfterMs : 0,
    );
    if (lockedMs > 0) {
      throw new CodeGuessLockedException(
        Math.max(1, Math.ceil(lockedMs / 1000)),
      );
    }
    this.perCode.hit(k.code);
    if (isNewCode) this.perClient.hit(k.client);
    let done = false;
    return {
      refund: () => {
        if (done) return;
        done = true;
        this.perCode.unhit(k.code);
        // The client's slot belongs to the code, not to one request: it goes
        // back only when no other attempt at that code is still counted.
        if (this.perCode.peek(k.code).count === 0)
          this.perClient.unhit(k.client);
      },
    };
  }
}
