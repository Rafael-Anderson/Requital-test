import { exactMinor, parseNomodEvent } from './nomod-events';

const buf = (o: unknown) => Buffer.from(JSON.stringify(o));

describe('exactMinor', () => {
  it('parses decimal strings exactly', () => {
    expect(exactMinor('45.00', 'AED')).toBe(4500);
    expect(exactMinor('45', 'AED')).toBe(4500);
    expect(exactMinor('0.5', 'AED')).toBe(50);
    expect(exactMinor('45.000', 'AED')).toBe(4500);
  });
  it('never rounds: extra non-zero precision is not a match', () => {
    expect(exactMinor('45.005', 'AED')).toBeNull();
  });
  it('rejects junk, negatives and a missing currency', () => {
    for (const v of [
      'abc',
      '-1',
      '1e3',
      '',
      ' ',
      '1,5',
      null,
      undefined,
      {},
      [],
    ]) {
      expect(exactMinor(v, 'AED')).toBeNull();
    }
    expect(exactMinor('45.00', null)).toBeNull();
  });
  it('accepts a plain finite number', () => {
    expect(exactMinor(45, 'AED')).toBe(4500);
    expect(exactMinor(Number.NaN, 'AED')).toBeNull();
  });
});

describe('parseNomodEvent', () => {
  const completed = {
    type: 'charge.completed',
    eventId: 'evt_1',
    objectId: 'chg_1',
    data: {
      total: '45.00',
      currency: 'aed',
      status: 'paid',
      referenceId: '42',
      customer: { email: 'someone@example.com' },
    },
  };

  it('parses a completed event', () => {
    expect(parseNomodEvent(buf(completed))).toEqual({
      eventId: 'evt_1',
      type: 'charge.completed',
      objectId: 'chg_1',
      referenceId: '42',
      currency: 'AED',
      totalMinor: 4500,
      refundTotalMinor: null,
      status: 'paid',
      missing: [],
    });
  });

  it('names what is missing instead of guessing', () => {
    const e = parseNomodEvent(
      buf({ type: 'charge.completed', eventId: 'e', data: {} }),
    )!;
    expect(e.totalMinor).toBeNull();
    expect(e.missing).toEqual(
      expect.arrayContaining([
        'data.referenceId',
        'data.currency',
        'data.total',
      ]),
    );
  });

  it('does not put customer data anywhere in the result', () => {
    expect(JSON.stringify(parseNomodEvent(buf(completed)))).not.toContain(
      'someone@example.com',
    );
  });

  it('reads refundTotal on refund events', () => {
    const e = parseNomodEvent(
      buf({
        type: 'charge.refunded',
        eventId: 'e',
        data: {
          referenceId: '1',
          currency: 'AED',
          total: '45.00',
          refundTotal: '45.00',
        },
      }),
    )!;
    expect(e.refundTotalMinor).toBe(4500);
    expect(e.missing).toEqual([]);
  });

  it('derives a stable id from the body when eventId is absent', () => {
    const body = buf({ type: 'charge.created', data: { referenceId: '1' } });
    const a = parseNomodEvent(body)!;
    const b = parseNomodEvent(body)!;
    expect(a.eventId).toMatch(/^body:[0-9a-f]{40}$/);
    expect(a.eventId).toBe(b.eventId);
  });

  it('returns null for anything that is not an object with a type', () => {
    for (const raw of [
      'not json',
      '[]',
      '"x"',
      'null',
      '{"data":{}}',
      '{"type":5}',
    ]) {
      expect(parseNomodEvent(Buffer.from(raw))).toBeNull();
    }
  });

  it('ignores an over-long or non-string id', () => {
    const e = parseNomodEvent(
      buf({
        type: 'charge.created',
        eventId: 'x'.repeat(500),
        objectId: 7,
        data: {},
      }),
    )!;
    expect(e.eventId.startsWith('body:')).toBe(true);
    expect(e.objectId).toBeNull();
  });
});
