import { createHmac } from 'crypto';
import {
  pickWebhookHeaders,
  verifyStandardWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from './nomod-signature';

const KEY = Buffer.from('a-sufficiently-long-signing-key-123');
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = 1_800_000_000;

function sign(id: string, ts: string | number, body: Buffer, key = KEY) {
  return createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(`${id}.${ts}.`), body]))
    .digest('base64');
}

describe('verifyStandardWebhook', () => {
  const body = Buffer.from('{"type":"charge.completed","eventId":"e1"}');
  const base = () => ({
    headers: {
      id: 'msg_1',
      timestamp: String(NOW),
      signature: `v1,${sign('msg_1', NOW, body)}`,
    },
    rawBody: body,
    secret: SECRET,
    nowSeconds: NOW,
  });

  it('accepts a correctly signed delivery', () => {
    expect(verifyStandardWebhook(base())).toEqual({ ok: true });
  });

  it('accepts a secret given without the whsec_ prefix', () => {
    expect(
      verifyStandardWebhook({ ...base(), secret: KEY.toString('base64') }),
    ).toEqual({ ok: true });
  });

  it('rejects a signature made with a different secret', () => {
    const wrong = sign(
      'msg_1',
      NOW,
      body,
      Buffer.from('another-secret-entirely-xx'),
    );
    const v = verifyStandardWebhook({
      ...base(),
      headers: { ...base().headers, signature: `v1,${wrong}` },
    });
    expect(v).toEqual({ ok: false, reason: 'no_matching_signature' });
  });

  it('rejects a tampered body', () => {
    const v = verifyStandardWebhook({
      ...base(),
      rawBody: Buffer.from('{"type":"charge.completed","eventId":"e2"}'),
    });
    expect(v.ok).toBe(false);
  });

  it('rejects a tampered id or timestamp (both are signed)', () => {
    const b = base();
    expect(
      verifyStandardWebhook({ ...b, headers: { ...b.headers, id: 'msg_2' } })
        .ok,
    ).toBe(false);
    expect(
      verifyStandardWebhook({
        ...b,
        headers: { ...b.headers, timestamp: String(NOW + 1) },
      }).ok,
    ).toBe(false);
  });

  it('rejects a timestamp older than 5 minutes, and one too far in the future', () => {
    const old = NOW - WEBHOOK_TOLERANCE_SECONDS - 1;
    const sigOld = sign('msg_1', old, body);
    expect(
      verifyStandardWebhook({
        ...base(),
        headers: {
          id: 'msg_1',
          timestamp: String(old),
          signature: `v1,${sigOld}`,
        },
      }),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_range' });
    const future = NOW + WEBHOOK_TOLERANCE_SECONDS + 1;
    expect(
      verifyStandardWebhook({
        ...base(),
        headers: {
          id: 'msg_1',
          timestamp: String(future),
          signature: `v1,${sign('msg_1', future, body)}`,
        },
      }),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_range' });
  });

  it('accepts a timestamp exactly at the 5 minute edge', () => {
    const edge = NOW - WEBHOOK_TOLERANCE_SECONDS;
    expect(
      verifyStandardWebhook({
        ...base(),
        headers: {
          id: 'msg_1',
          timestamp: String(edge),
          signature: `v1,${sign('msg_1', edge, body)}`,
        },
      }).ok,
    ).toBe(true);
  });

  it('accepts when ANY of several space-separated v1 entries matches (rotation)', () => {
    const stale = sign(
      'msg_1',
      NOW,
      body,
      Buffer.from('the-old-rotated-key-value-aaaa'),
    );
    const good = sign('msg_1', NOW, body);
    for (const header of [`v1,${stale} v1,${good}`, `v1,${good} v1,${stale}`]) {
      expect(
        verifyStandardWebhook({
          ...base(),
          headers: { ...base().headers, signature: header },
        }).ok,
      ).toBe(true);
    }
  });

  it('ignores entries of another version and malformed entries', () => {
    const good = sign('msg_1', NOW, body);
    expect(
      verifyStandardWebhook({
        ...base(),
        headers: { ...base().headers, signature: `v2,${good} garbage v1` },
      }).ok,
    ).toBe(false);
  });

  it('never throws on a truncated or empty signature', () => {
    for (const signature of ['v1,', 'v1,AAAA', 'v1', '']) {
      expect(() =>
        verifyStandardWebhook({
          ...base(),
          headers: { ...base().headers, signature },
        }),
      ).not.toThrow();
    }
  });

  it('rejects missing headers, a bad secret and a bad timestamp', () => {
    expect(verifyStandardWebhook({ ...base(), headers: {} })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(verifyStandardWebhook({ ...base(), secret: '' })).toEqual({
      ok: false,
      reason: 'bad_secret',
    });
    expect(
      verifyStandardWebhook({
        ...base(),
        headers: { ...base().headers, timestamp: 'abc' },
      }),
    ).toEqual({ ok: false, reason: 'bad_timestamp' });
  });
});

describe('pickWebhookHeaders', () => {
  it('reads svix-* headers', () => {
    expect(
      pickWebhookHeaders({
        'svix-id': 'a',
        'svix-timestamp': '1',
        'svix-signature': 'v1,x',
      }),
    ).toEqual({ id: 'a', timestamp: '1', signature: 'v1,x' });
  });

  it('also accepts the webhook-* names', () => {
    expect(
      pickWebhookHeaders({
        'webhook-id': 'a',
        'webhook-timestamp': '1',
        'webhook-signature': 'v1,x',
      }),
    ).toEqual({ id: 'a', timestamp: '1', signature: 'v1,x' });
  });

  it('prefers svix-* when both are present, and treats a repeated header as absent', () => {
    expect(
      pickWebhookHeaders({
        'svix-id': 'svix',
        'webhook-id': 'webhook',
        'svix-timestamp': ['1', '2'],
        'webhook-timestamp': '9',
      }),
    ).toMatchObject({ id: 'svix', timestamp: '9' });
  });

  it('verifies end to end using the webhook-* names', () => {
    const body = Buffer.from('{}');
    const headers = pickWebhookHeaders({
      'webhook-id': 'm',
      'webhook-timestamp': String(NOW),
      'webhook-signature': `v1,${sign('m', NOW, body)}`,
    });
    expect(
      verifyStandardWebhook({
        headers,
        rawBody: body,
        secret: SECRET,
        nowSeconds: NOW,
      }).ok,
    ).toBe(true);
  });
});
