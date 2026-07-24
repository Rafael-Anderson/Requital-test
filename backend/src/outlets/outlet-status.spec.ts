import { computeIsOpen } from './outlet-status';

// A fixed weekly schedule, open 09:00-18:00 every day.
const REGULAR_HOURS = {
  sun: { open: '09:00', close: '18:00', closed: false },
  mon: { open: '09:00', close: '18:00', closed: false },
  tue: { open: '09:00', close: '18:00', closed: false },
  wed: { open: '09:00', close: '18:00', closed: false },
  thu: { open: '09:00', close: '18:00', closed: false },
  fri: { open: '09:00', close: '18:00', closed: false },
  sat: { open: '09:00', close: '18:00', closed: false },
};

// Overnight span wrapping past midnight.
const OVERNIGHT_HOURS = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [
    d,
    { open: '22:00', close: '02:00', closed: false },
  ]),
);

function setSystemTime(iso: string) {
  jest.useFakeTimers({ advanceTimers: false }).setSystemTime(new Date(iso));
}

afterEach(() => {
  jest.useRealTimers();
});

describe('computeIsOpen', () => {
  it('defaults to open when no schedule has been configured yet', () => {
    // 2026-01-01 is a Thursday.
    setSystemTime('2026-01-01T12:00:00Z');
    expect(computeIsOpen(null, false, null, 'UTC')).toBe(true);
  });

  it('is open in the middle of today\'s window', () => {
    setSystemTime('2026-01-01T12:00:00Z'); // Thu 12:00 UTC
    expect(computeIsOpen(REGULAR_HOURS, false, null, 'UTC')).toBe(true);
  });

  it('is open exactly at the opening minute (inclusive)', () => {
    setSystemTime('2026-01-01T09:00:00Z');
    expect(computeIsOpen(REGULAR_HOURS, false, null, 'UTC')).toBe(true);
  });

  it('is closed exactly at the closing minute (exclusive)', () => {
    setSystemTime('2026-01-01T18:00:00Z');
    expect(computeIsOpen(REGULAR_HOURS, false, null, 'UTC')).toBe(false);
  });

  it('is closed one minute before opening', () => {
    setSystemTime('2026-01-01T08:59:00Z');
    expect(computeIsOpen(REGULAR_HOURS, false, null, 'UTC')).toBe(false);
  });

  it('is closed one minute after closing', () => {
    setSystemTime('2026-01-01T18:01:00Z');
    expect(computeIsOpen(REGULAR_HOURS, false, null, 'UTC')).toBe(false);
  });

  it('respects a day explicitly marked closed regardless of the time', () => {
    setSystemTime('2026-01-01T12:00:00Z'); // Thu, within 09:00-18:00
    const hours = { ...REGULAR_HOURS, thu: { open: '09:00', close: '18:00', closed: true } };
    expect(computeIsOpen(hours, false, null, 'UTC')).toBe(false);
  });

  describe('overnight hours (22:00-02:00)', () => {
    it('is open shortly after opening, before midnight', () => {
      setSystemTime('2026-01-01T23:00:00Z');
      expect(computeIsOpen(OVERNIGHT_HOURS, false, null, 'UTC')).toBe(true);
    });

    it('is open shortly after midnight, before closing', () => {
      setSystemTime('2026-01-02T01:00:00Z');
      expect(computeIsOpen(OVERNIGHT_HOURS, false, null, 'UTC')).toBe(true);
    });

    it('is closed mid-afternoon, well outside the overnight window', () => {
      setSystemTime('2026-01-01T12:00:00Z');
      expect(computeIsOpen(OVERNIGHT_HOURS, false, null, 'UTC')).toBe(false);
    });

    it('is closed just after the overnight window ends', () => {
      setSystemTime('2026-01-02T03:00:00Z');
      expect(computeIsOpen(OVERNIGHT_HOURS, false, null, 'UTC')).toBe(false);
    });
  });

  describe('manual force-closed override', () => {
    it('overrides open hours when set today', () => {
      setSystemTime('2026-01-01T12:00:00Z'); // within open hours
      const setAt = new Date('2026-01-01T08:00:00Z'); // same UTC day
      expect(computeIsOpen(REGULAR_HOURS, true, setAt, 'UTC')).toBe(false);
    });

    it('auto-expires at the next day rollover and falls back to computed hours', () => {
      setSystemTime('2026-01-01T12:00:00Z'); // "now" — within open hours
      const setAt = new Date('2025-12-31T08:00:00Z'); // set the day before
      expect(computeIsOpen(REGULAR_HOURS, true, setAt, 'UTC')).toBe(true);
    });

    it('treats a missing timestamp as already expired, not indefinitely active', () => {
      setSystemTime('2026-01-01T12:00:00Z');
      expect(computeIsOpen(REGULAR_HOURS, true, null, 'UTC')).toBe(true);
    });

    it('does not fire when closedOverride is false, regardless of the timestamp', () => {
      setSystemTime('2026-01-01T12:00:00Z');
      const setAt = new Date('2026-01-01T08:00:00Z');
      expect(computeIsOpen(REGULAR_HOURS, false, setAt, 'UTC')).toBe(true);
    });
  });

  describe('timezone awareness', () => {
    // 2026-01-01T21:00:00Z is Thursday 21:00 in UTC, but 01:00 Friday in
    // Asia/Dubai (UTC+4, no DST) — a different calendar day. Thursday is
    // open all day; Friday is marked closed. The same instant must resolve
    // differently depending on which timezone is passed in, proving this
    // does real per-timezone conversion rather than reading the system/UTC
    // clock directly.
    const hours = {
      ...REGULAR_HOURS,
      thu: { open: '00:00', close: '23:59', closed: false },
      fri: { open: '00:00', close: '23:59', closed: true },
    };

    it('resolves against the outlet/shop timezone, not UTC', () => {
      setSystemTime('2026-01-01T21:00:00Z');
      expect(computeIsOpen(hours, false, null, 'UTC')).toBe(true); // still Thursday in UTC
      expect(computeIsOpen(hours, false, null, 'Asia/Dubai')).toBe(false); // already Friday in Dubai
    });
  });
});
