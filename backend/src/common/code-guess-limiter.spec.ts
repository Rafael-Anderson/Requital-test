import {
  CODE_GUESS_MAX_DISTINCT_FAILURES,
  CODE_GUESS_MAX_REPEATS,
  CODE_GUESS_WINDOW_MS,
  CodeGuessLimiter,
  CodeGuessLockedException,
} from './code-guess-limiter';
import {
  GENERIC_DISCOUNT_MESSAGE,
  toPublicDiscountResult,
} from '../discounts/discount-constants';

describe('CodeGuessLimiter', () => {
  const prev = process.env.THROTTLE_IN_TESTS;
  let t: number;
  let l: CodeGuessLimiter;
  beforeEach(() => {
    process.env.THROTTLE_IN_TESTS = '1';
    t = 1_000_000;
    l = new CodeGuessLimiter();
    l.now = () => t;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = prev;
  });

  // distinct failing codes: reserved and never refunded
  const fail = (shop: number, ip: string, n: number, prefix = 'C') => {
    for (let i = 0; i < n; i++) l.reserve(shop, ip, `${prefix}${i}`);
  };

  it('allows the budget, then locks that client with a Retry-After', () => {
    fail(1, '1.1.1.1', CODE_GUESS_MAX_DISTINCT_FAILURES);
    let err: unknown;
    try {
      l.reserve(1, '1.1.1.1', 'ANY');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CodeGuessLockedException);
    expect((err as CodeGuessLockedException).getStatus()).toBe(429);
    expect((err as CodeGuessLockedException).retryAfterSeconds).toBe(
      CODE_GUESS_WINDOW_MS / 1000,
    );
  });

  it('a parallel burst cannot overshoot: the budget is taken before any lookup', () => {
    // 40 attempts at distinct codes arrive "at once": each reserve() runs to
    // completion before the next starts (no await), exactly like requests that
    // all pass the check before any of them has done its DB lookup.
    let reachedLookup = 0;
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      try {
        l.reserve(1, '9.9.9.9', `BURST${i}`);
        reachedLookup++;
      } catch {
        refused++;
      }
    }
    expect(reachedLookup).toBe(CODE_GUESS_MAX_DISTINCT_FAILURES);
    expect(refused).toBe(30);
  });

  it('a refund (valid code, or any non-revealing outcome) gives the slot back', () => {
    const tickets = Array.from(
      { length: CODE_GUESS_MAX_DISTINCT_FAILURES },
      (_, i) => l.reserve(1, '1.1.1.1', `C${i}`),
    );
    expect(() => l.reserve(1, '1.1.1.1', 'NEW')).toThrow(
      CodeGuessLockedException,
    );
    tickets[3].refund();
    expect(() => l.reserve(1, '1.1.1.1', 'NEW')).not.toThrow();
    // refunding twice must not hand out a second slot
    tickets[3].refund();
    expect(() => l.reserve(1, '1.1.1.1', 'NEW2')).toThrow(
      CodeGuessLockedException,
    );
  });

  it('a real code a shopper types is never locked out by an in-flight burst of wrong ones below the budget', () => {
    fail(1, '1.1.1.1', CODE_GUESS_MAX_DISTINCT_FAILURES - 1);
    const t1 = l.reserve(1, '1.1.1.1', 'REAL');
    t1.refund(); // it was valid
    expect(() => l.reserve(1, '1.1.1.1', 'REAL')).not.toThrow();
  });

  it('is keyed by shop and by client, so one client cannot lock another out', () => {
    fail(1, '1.1.1.1', CODE_GUESS_MAX_DISTINCT_FAILURES);
    expect(() => l.reserve(2, '1.1.1.1', 'X')).not.toThrow(); // other shop
    expect(() => l.reserve(1, '2.2.2.2', 'X')).not.toThrow(); // other client
  });

  it('never locks a code on its own: a victim types a code an attacker spammed', () => {
    for (let i = 0; i < CODE_GUESS_MAX_REPEATS; i++) {
      l.reserve(1, '6.6.6.6', 'REALCODE');
    }
    expect(() => l.reserve(1, '6.6.6.6', 'REALCODE')).toThrow(
      CodeGuessLockedException,
    );
    expect(() => l.reserve(1, '7.7.7.7', 'REALCODE')).not.toThrow();
  });

  it('repeats of one wrong code spend one slot of the distinct budget', () => {
    for (let i = 0; i < 20; i++) l.reserve(1, '3.3.3.3', 'TYPO');
    fail(1, '3.3.3.3', CODE_GUESS_MAX_DISTINCT_FAILURES - 2, 'D');
    expect(() => l.reserve(1, '3.3.3.3', 'OK')).not.toThrow();
  });

  it('keeps the client slot while another attempt at the same code is still counted', () => {
    const a = l.reserve(1, '4.4.4.4', 'SAME');
    l.reserve(1, '4.4.4.4', 'SAME'); // a second, concurrent attempt
    a.refund();
    // the slot is still held by the second attempt: 9 more distinct codes fill it
    fail(1, '4.4.4.4', CODE_GUESS_MAX_DISTINCT_FAILURES - 1, 'E');
    expect(() => l.reserve(1, '4.4.4.4', 'ONEMORE')).toThrow(
      CodeGuessLockedException,
    );
  });

  it('normalises the code (case and padding) before keying', () => {
    for (let i = 0; i < CODE_GUESS_MAX_REPEATS; i++) {
      l.reserve(1, '4.4.4.4', ' spring10 ');
    }
    expect(() => l.reserve(1, '4.4.4.4', 'SPRING10')).toThrow(
      CodeGuessLockedException,
    );
  });

  it('frees the client when the window passes', () => {
    fail(1, '5.5.5.5', CODE_GUESS_MAX_DISTINCT_FAILURES);
    t += CODE_GUESS_WINDOW_MS + 1;
    expect(() => l.reserve(1, '5.5.5.5', 'X')).not.toThrow();
  });

  it('does nothing under Jest unless THROTTLE_IN_TESTS=1', () => {
    delete process.env.THROTTLE_IN_TESTS;
    fail(1, '8.8.8.8', 50);
    expect(() => l.reserve(1, '8.8.8.8', 'X')).not.toThrow();
  });
});

describe('toPublicDiscountResult', () => {
  it.each(['not_found', 'inactive', 'not_started', 'expired'] as const)(
    '%s collapses to one answer',
    (reason) => {
      expect(
        toPublicDiscountResult({ valid: false, reason, message: 'specific' }),
      ).toEqual({
        valid: false,
        reason: 'not_found',
        message: GENERIC_DISCOUNT_MESSAGE,
      });
    },
  );

  it.each([
    'min_purchase_not_met',
    'usage_limit_reached',
    'per_customer_limit_reached',
    'not_eligible',
  ] as const)('%s keeps its specific message', (reason) => {
    const r = { valid: false, reason, message: 'specific' };
    expect(toPublicDiscountResult(r)).toBe(r);
  });
});
