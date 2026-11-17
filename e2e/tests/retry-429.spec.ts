import { expect, test } from '@playwright/test';
import { retryOn429, waitFor429 } from '../retry-429';

// Pure unit tests of the seed's 429 retry helper: no browser, no backend.

function response(status: number, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return new Response(status === 204 ? null : '{}', { status, headers });
}

function scripted(statuses: Array<[number, string?]>) {
  let calls = 0;
  const waits: number[] = [];
  return {
    doFetch: () => {
      const [status, retryAfter] = statuses[Math.min(calls, statuses.length - 1)];
      calls++;
      return Promise.resolve(response(status, retryAfter));
    },
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    calls: () => calls,
    waits,
  };
}

const opts = { maxSingleWaitMs: 65_000, fallbackWaitMs: 15_000, marginMs: 500 };

test('waitFor429 honours Retry-After seconds, falls back when missing or unusable, and caps each wait', () => {
  expect(waitFor429('7', opts)).toBe(7_500);
  expect(waitFor429(null, opts)).toBe(15_500);
  expect(waitFor429('', opts)).toBe(15_500);
  expect(waitFor429('soon', opts)).toBe(15_500);
  expect(waitFor429('0', opts)).toBe(15_500);
  expect(waitFor429('-3', opts)).toBe(15_500);
  expect(waitFor429('600', opts)).toBe(65_500);
});

test('a non-429 response is returned at once, without waiting', async () => {
  const s = scripted([[200]]);
  const res = await retryOn429(s.doFetch, { sleep: s.sleep });
  expect(res.status).toBe(200);
  expect(s.calls()).toBe(1);
  expect(s.waits).toEqual([]);
});

test('other errors are not retried', async () => {
  const s = scripted([[500]]);
  const res = await retryOn429(s.doFetch, { sleep: s.sleep });
  expect(res.status).toBe(500);
  expect(s.calls()).toBe(1);
});

test('a 429 is waited out for Retry-After and the same request is sent again', async () => {
  const s = scripted([[429, '12'], [429, '3'], [201]]);
  const res = await retryOn429(s.doFetch, { sleep: s.sleep });
  expect(res.status).toBe(201);
  expect(s.calls()).toBe(3);
  expect(s.waits).toEqual([12_500, 3_500]);
});

test('the total wait is bounded: a throttle that never lifts returns the last 429', async () => {
  const s = scripted([[429, '60']]);
  const res = await retryOn429(s.doFetch, { sleep: s.sleep, maxTotalWaitMs: 70_000 });
  expect(res.status).toBe(429);
  expect(s.waits.reduce((a, b) => a + b, 0)).toBe(70_000);
  expect(s.waits).toEqual([60_500, 9_500]);
  expect(s.calls()).toBe(3);
});
