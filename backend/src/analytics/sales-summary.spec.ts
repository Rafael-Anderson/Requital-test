import {
  minutesInTimezone,
  resolveCloseMinutes,
} from './sales-summary.service';

describe('resolveCloseMinutes', () => {
  const hours = {
    sun: { open: '09:00', close: '18:00', closed: false },
    mon: { open: '09:00', close: '21:30', closed: false },
    tue: { open: '09:00', close: '18:00', closed: true },
    wed: { open: '09:00', close: '18:00', closed: false },
    thu: { open: '09:00', close: '18:00', closed: false },
    fri: { open: '09:00', close: '18:00', closed: false },
    sat: { open: '09:00', close: '18:00', closed: false },
  };

  it('reads the close time for the given weekday', () => {
    expect(resolveCloseMinutes(hours, 1)).toBe(21 * 60 + 30); // Monday
    expect(resolveCloseMinutes(hours, 3)).toBe(18 * 60); // Wednesday
  });

  // A closed day has no close time to fire at. Returning a default would email
  // the merchant at an arbitrary hour on a day they were shut.
  it('returns null for a day the shop is closed', () => {
    expect(resolveCloseMinutes(hours, 2)).toBeNull(); // Tuesday
  });

  it('falls back to a sane default when hours are not configured at all', () => {
    expect(resolveCloseMinutes(null, 1)).toBe(20 * 60);
    expect(resolveCloseMinutes(undefined, 1)).toBe(20 * 60);
    expect(resolveCloseMinutes({}, 1)).toBe(20 * 60);
  });

  it('falls back when the stored close time is malformed rather than throwing', () => {
    expect(resolveCloseMinutes({ mon: { close: 'evening' } }, 1)).toBe(20 * 60);
    expect(resolveCloseMinutes({ mon: { close: '25:00' } }, 1)).toBe(20 * 60);
    expect(resolveCloseMinutes({ mon: { close: '' } }, 1)).toBe(20 * 60);
    expect(resolveCloseMinutes({ mon: {} }, 1)).toBe(20 * 60);
  });

  it('handles midnight and the last minute of the day', () => {
    expect(resolveCloseMinutes({ mon: { close: '00:00' } }, 1)).toBe(0);
    expect(resolveCloseMinutes({ mon: { close: '23:59' } }, 1)).toBe(
      23 * 60 + 59,
    );
  });

  it('is not fooled by a non-object stored in the column', () => {
    expect(resolveCloseMinutes('nonsense', 1)).toBe(20 * 60);
    expect(resolveCloseMinutes(42, 1)).toBe(20 * 60);
  });
});

describe('minutesInTimezone', () => {
  // 18:00 UTC is 22:00 in Dubai (UTC+4, no DST), which is the whole reason the
  // sweep cannot just read the server clock.
  it('reports wall-clock minutes in the given zone, not the server zone', () => {
    const at18UTC = new Date('2026-09-22T18:00:00.000Z');
    expect(minutesInTimezone(at18UTC, 'UTC')).toBe(18 * 60);
    expect(minutesInTimezone(at18UTC, 'Asia/Dubai')).toBe(22 * 60);
  });

  it('handles the rollover past midnight in the shop zone', () => {
    // 21:00 UTC is 01:00 the NEXT day in Dubai.
    const at21UTC = new Date('2026-09-22T21:00:00.000Z');
    expect(minutesInTimezone(at21UTC, 'Asia/Dubai')).toBe(60);
  });

  it('reports midnight as zero, not 1440', () => {
    expect(minutesInTimezone(new Date('2026-09-22T00:00:00.000Z'), 'UTC')).toBe(
      0,
    );
  });
});
