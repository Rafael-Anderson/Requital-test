import {
  generateSurveyToken,
  generateTrackingToken,
  TRACKING_TOKEN_SHAPE,
  withTrackingToken,
} from './token-hash';

describe('generateSurveyToken', () => {
  it('is 128 bits as 32 uppercase hex characters, and does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = generateSurveyToken();
      expect(t).toMatch(/^[0-9A-F]{32}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
});

describe('generateTrackingToken', () => {
  it('is 128 bits as 32 uppercase hex characters, and does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = generateTrackingToken();
      expect(t).toMatch(/^[0-9A-F]{32}$/);
      expect(TRACKING_TOKEN_SHAPE.test(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });

  it('shape accepts the new and legacy widths only', () => {
    expect(TRACKING_TOKEN_SHAPE.test('0123456789')).toBe(true);
    expect(TRACKING_TOKEN_SHAPE.test('abcdef0123')).toBe(true);
    for (const n of [0, 1, 9, 11, 16, 31, 33, 64]) {
      expect(TRACKING_TOKEN_SHAPE.test('A'.repeat(n))).toBe(false);
    }
    expect(TRACKING_TOKEN_SHAPE.test('G'.repeat(32))).toBe(false);
    expect(TRACKING_TOKEN_SHAPE.test('A'.repeat(32) + '\n')).toBe(false);
  });
});

describe('withTrackingToken', () => {
  const dup = (key: string) =>
    Object.assign(new Error(`Duplicate entry 'X' for key '${key}'`), {
      errno: 1062,
    });

  it('retries a trackingToken collision with a fresh token', async () => {
    const used: string[] = [];
    const out = await withTrackingToken((t) => {
      used.push(t);
      if (used.length < 3) return Promise.reject(dup('order.Order_trackingToken_key'));
      return Promise.resolve(t);
    });
    expect(out).toBe(used[2]);
    expect(new Set(used).size).toBe(3);
  });

  it('gives up after three collisions and rethrows other errors untouched', async () => {
    let n = 0;
    await expect(
      withTrackingToken(() => {
        n++;
        return Promise.reject(dup('order.Order_trackingToken_key'));
      }),
    ).rejects.toThrow('Duplicate entry');
    expect(n).toBe(3);

    n = 0;
    await expect(
      withTrackingToken(() => {
        n++;
        return Promise.reject(dup('order.Order_shopId_shopOrderNumber_key'));
      }),
    ).rejects.toThrow('Duplicate entry');
    expect(n).toBe(1);
  });
});
