import {
  buildWebhookBody,
  detectWebhookFlavour,
  renderErrorText,
} from './webhook-payload';
import type { CapturedErrorPayload } from './webhook-payload';

const payload = (over: Partial<CapturedErrorPayload> = {}) =>
  ({
    message: 'Cannot read properties of undefined (reading id)',
    stack:
      'TypeError: Cannot read properties of undefined (reading id)\n' +
      '    at OrdersService.confirm (/app/dist/orders/orders.service.js:214:33)\n' +
      '    at OrdersController.updateStatus (/app/dist/orders/orders.controller.js:88:5)',
    requestId: 'a1b2c3d4',
    shopId: 12,
    route: '/orders/:id/status',
    method: 'PATCH',
    capturedAt: '2026-09-19T12:00:00.000Z',
    ...over,
  }) satisfies CapturedErrorPayload;

describe('detectWebhookFlavour', () => {
  it('recognises a Slack incoming webhook', () => {
    expect(
      detectWebhookFlavour('https://hooks.slack.com/services/T0/B0/xxx'),
    ).toBe('slack');
  });

  it('recognises a Discord webhook, including the ptb/canary hosts', () => {
    expect(
      detectWebhookFlavour('https://discord.com/api/webhooks/123/abc'),
    ).toBe('discord');
    expect(
      detectWebhookFlavour('https://discordapp.com/api/webhooks/123/abc'),
    ).toBe('discord');
    expect(
      detectWebhookFlavour('https://canary.discord.com/api/webhooks/123/abc'),
    ).toBe('discord');
  });

  it('falls back to the generic shape for anything else', () => {
    expect(detectWebhookFlavour('https://sentry.io/api/1/store/')).toBe('json');
    expect(detectWebhookFlavour('https://ops.example.com/collect')).toBe(
      'json',
    );
  });

  it('does not match a lookalike hostname', () => {
    expect(detectWebhookFlavour('https://hooks.slack.com.evil.test/x')).toBe(
      'json',
    );
    expect(detectWebhookFlavour('https://notdiscord.com/api/webhooks/1')).toBe(
      'json',
    );
  });

  it('falls back to the generic shape rather than throwing on a bad URL', () => {
    expect(detectWebhookFlavour('not a url')).toBe('json');
  });
});

describe('buildWebhookBody', () => {
  it('passes the payload through untouched for a non-chat destination', () => {
    const p = payload();
    expect(buildWebhookBody('https://ops.example.com/collect', p)).toBe(p);
  });

  it('wraps in { text } for Slack', () => {
    const body = buildWebhookBody(
      'https://hooks.slack.com/services/T0/B0/xxx',
      payload(),
    ) as { text: string };
    expect(Object.keys(body)).toEqual(['text']);
    expect(body.text).toContain('Requital backend error');
    expect(body.text).toContain('PATCH /orders/:id/status');
  });

  it('wraps in { content } for Discord', () => {
    const body = buildWebhookBody(
      'https://discord.com/api/webhooks/123/abc',
      payload(),
    ) as { content: string };
    expect(Object.keys(body)).toEqual(['content']);
    expect(body.content).toContain('Requital backend error');
  });

  it("stays under Discord's 2000-character content limit", () => {
    const body = buildWebhookBody(
      'https://discord.com/api/webhooks/123/abc',
      payload({
        message: 'x'.repeat(5000),
        stack: `Error\n${'    at somewhere/very/long/path.js:1:1\n'.repeat(200)}`,
      }),
    ) as { content: string };
    expect(body.content.length).toBeLessThanOrEqual(2000);
    expect(body.content).toContain('[truncated]');
  });
});

describe('renderErrorText', () => {
  it('leads with the message and the request location', () => {
    const lines = renderErrorText(payload()).split('\n');
    expect(lines[0]).toContain('Requital backend error');
    expect(lines[1]).toBe('PATCH /orders/:id/status  |  shop 12  |  req a1b2c3d4');
    expect(lines[2]).toBe('Cannot read properties of undefined (reading id)');
  });

  it('does not repeat the message inside the stack block', () => {
    const text = renderErrorText(payload());
    const occurrences = text.split(
      'Cannot read properties of undefined (reading id)',
    ).length - 1;
    expect(occurrences).toBe(1);
    expect(text).toContain('at OrdersService.confirm');
  });

  it('omits the metadata line entirely when there is no context', () => {
    const text = renderErrorText({
      message: 'boom',
      capturedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(text).toBe('\u{1F6A8} Requital backend error\nboom');
  });

  it('keeps shopId 0 out of the metadata line only when absent, not when zero', () => {
    expect(
      renderErrorText({ message: 'boom', shopId: 0, capturedAt: 'x' }),
    ).toContain('shop 0');
    expect(
      renderErrorText({ message: 'boom', capturedAt: 'x' }),
    ).not.toContain('shop');
  });

  it('renders a non-string message rather than [object Object]', () => {
    const text = renderErrorText({
      message: { weird: true },
      capturedAt: 'x',
    });
    expect(text).toContain('{"weird":true}');
    expect(text).not.toContain('[object Object]');
  });

  it('ignores a non-string stack instead of throwing', () => {
    expect(() =>
      renderErrorText({ message: 'boom', stack: 42, capturedAt: 'x' }),
    ).not.toThrow();
  });
});
