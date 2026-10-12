import {
  isScrubbedPayload,
  scrubSensitivePayload,
  SCRUBBED,
} from './job-payload-scrub';

describe('scrubSensitivePayload', () => {
  it('replaces every message text field of a sensitive payload and keeps routing data', () => {
    const out = scrubSensitivePayload({
      to: 'a@b.c',
      subject: 'Your delivery code',
      bodyText: 'code 123456',
      html: '<b>123456</b>',
      sensitive: true,
    });
    expect(out).toMatchObject({
      to: 'a@b.c',
      subject: 'Your delivery code',
      bodyText: SCRUBBED,
      html: SCRUBBED,
      scrubbed: true,
    });
    expect(JSON.stringify(out)).not.toContain('123456');
    expect(isScrubbedPayload(out)).toBe(true);
  });

  it('leaves a non-sensitive payload untouched (same object)', () => {
    const p = { to: 'x', body: 'New order #1', orderId: 1 };
    expect(scrubSensitivePayload(p)).toBe(p);
  });
});
