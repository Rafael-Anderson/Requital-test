import { generateValidTimeSlots } from './time-slots';

const TZ = 'Asia/Dubai'; // UTC+4, this app's only real shop timezone.

describe('generateValidTimeSlots', () => {
  // A Wednesday, UTC midnight (= 4:00 AM in Asia/Dubai, still the same
  // calendar day there) — same fixture-date convention as the storefront's
  // own lib/slots.test.ts.
  const wed = new Date('2026-07-22T00:00:00Z');
  const hours = { wed: { closed: false, open: '09:00', close: '21:00' } };

  it('falls back to a 9am-9pm window when no hours are configured, matching the storefront default', () => {
    const farFuture = new Date('2026-01-01T00:00:00Z');
    const slots = generateValidTimeSlots(wed, null, 60, TZ, farFuture);
    expect(slots[0]).toBe('9:00 AM - 10:00 AM');
    expect(slots.at(-1)).toBe('8:00 PM - 9:00 PM');
    expect(slots).toHaveLength(12);
  });

  it('returns no slots when the day is marked closed', () => {
    const closedHours = { wed: { closed: true, open: '09:00', close: '21:00' } };
    const farFuture = new Date('2026-01-01T00:00:00Z');
    expect(generateValidTimeSlots(wed, closedHours, 60, TZ, farFuture)).toEqual([]);
  });

  it('returns every slot unfiltered when the target date is not today', () => {
    // "now" is a completely different day — no cutoff applies.
    const now = new Date('2026-01-01T12:00:00Z');
    expect(generateValidTimeSlots(wed, hours, 60, TZ, now)).toEqual([
      '9:00 AM - 10:00 AM',
      '10:00 AM - 11:00 AM',
      '11:00 AM - 12:00 PM',
      '12:00 PM - 1:00 PM',
      '1:00 PM - 2:00 PM',
      '2:00 PM - 3:00 PM',
      '3:00 PM - 4:00 PM',
      '4:00 PM - 5:00 PM',
      '5:00 PM - 6:00 PM',
      '6:00 PM - 7:00 PM',
      '7:00 PM - 8:00 PM',
      '8:00 PM - 9:00 PM',
    ]);
  });

  it('drops slots whose start has already passed when the target date is today (shop timezone)', () => {
    // 16:00 in Asia/Dubai (UTC+4) on the same Wednesday -> 12:00 UTC.
    const now = new Date('2026-07-22T12:00:00Z');
    const slots = generateValidTimeSlots(wed, hours, 60, TZ, now);
    expect(slots).toEqual([
      '4:00 PM - 5:00 PM',
      '5:00 PM - 6:00 PM',
      '6:00 PM - 7:00 PM',
      '7:00 PM - 8:00 PM',
      '8:00 PM - 9:00 PM',
    ]);
  });

  it('keeps a slot that starts exactly now — only a strictly-passed start is excluded', () => {
    // Exactly 4:00 PM Asia/Dubai.
    const now = new Date('2026-07-22T12:00:00Z');
    const slots = generateValidTimeSlots(wed, hours, 60, TZ, now);
    expect(slots).toContain('4:00 PM - 5:00 PM');
  });

  it('returns an empty list when every slot for today has already passed', () => {
    // 22:00 Asia/Dubai — past the 21:00 close.
    const now = new Date('2026-07-22T18:00:00Z');
    expect(generateValidTimeSlots(wed, hours, 60, TZ, now)).toEqual([]);
  });
});
