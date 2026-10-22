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

  const fail = (shop: number, ip: string, n: number, prefix = 'C') => {
    for (let i = 0; i < n; i++) {
      l.assertAllowed(shop, ip, `${prefix}${i}`);
      l.recordFailure(shop, ip, `${prefix}${i}`);
    }
  };

  it('allows the budget, then locks that client with a Retry-After', () => {
    fail(1, '1.1.1.1', CODE_GUESS_MAX_DISTINCT_FAILURES);
    let err: unknown;
    try {
      l.assertAllowed(1, '1.1.1.1', 'ANY');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CodeGuessLockedException);
    expect((err as CodeGuessLockedException).getStatus()).toBe(429);
    expect((err as CodeGuessLockedException).retryAfterSeconds).toBe(
      CODE_GUESS_WINDOW_MS / 1000,
    );
  });

  it('is keyed by shop and by client, so one client cannot lock another out', () => {
    fail(1, '1.1.1.1', CODE_GUESS_MAX_DISTINCT_FAILURES);
    expect(() => l.assertAllowed(2, '1.1.1.1', 'X')).not.toThrow(); // other shop
    expect(() => l.assertAllowed(1, '2.2.2.2', 'X')).not.toThrow(); // other client
  });

  it('never locks a code on its own: a victim types a code an attacker spammed', () => {
    // the attacker hammers one code far past every limit...
    for (let i = 0; i < CODE_GUESS_MAX_REPEATS + 5; i++) {
      l.recordFailure(1, '6.6.6.6', 'REALCODE');
    }
    expect(() => l.assertAllowed(1, '6.6.6.6', 'REALCODE')).toThrow(
      CodeGuessLockedException,
    );
    // ...and the same code from anyone else is untouched
    expect(() => l.assertAllowed(1, '7.7.7.7', 'REALCODE')).not.toThrow();
  });

  it('repeats of one wrong code spend one slot of the distinct budget', () => {
    for (let i = 0; i < 20; i++) l.recordFailure(1, '3.3.3.3', 'TYPO');
    fail(1, '3.3.3.3', CODE_GUESS_MAX_DISTINCT_FAILURES - 2, 'D');
    expect(() => l.assertAllowed(1, '3.3.3.3', 'OK')).not.toThrow();
  });

  it('normalises the code (case and padding) before keying', () => {
    for (let i = 0; i < CODE_GUESS_MAX_REPEATS; i++) {
      l.recordFailure(1, '4.4.4.4', ' spring10 ');
    }
    expect(() => l.assertAllowed(1, '4.4.4.4', 'SPRING10')).toThrow(
      CodeGuessLockedException,
    );
  });

  it('frees the client when the window passes', () => {
    fail(1, '5.5.5.5', CODE_GUESS_MAX_DISTINCT_FAILURES);
    t += CODE_GUESS_WINDOW_MS + 1;
    expect(() => l.assertAllowed(1, '5.5.5.5', 'X')).not.toThrow();
  });

  it('does nothing under Jest unless THROTTLE_IN_TESTS=1', () => {
    delete process.env.THROTTLE_IN_TESTS;
    fail(1, '8.8.8.8', 50);
    expect(() => l.assertAllowed(1, '8.8.8.8', 'X')).not.toThrow();
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
