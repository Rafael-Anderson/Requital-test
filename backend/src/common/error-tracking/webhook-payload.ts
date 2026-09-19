// Turns a captured-error payload into the body the configured webhook will
// actually accept.
//
// The generic JSON shape (message/stack/requestId/shopId/route/method/
// capturedAt) is what this has always POSTed and stays the default — Sentry's
// generic ingestion, PagerDuty's Events API, a custom collector, all want the
// structured object. But the two destinations a small team realistically sets
// up in two minutes are a Slack or Discord incoming webhook, and both REJECT
// an arbitrary object: Slack needs `text` (or `blocks`) and answers
// `invalid_payload`, Discord needs `content` (or `embeds`) and answers 400.
// So those two get a rendered message instead, detected from the webhook
// hostname — the merchant of this config pastes one URL and nothing else.
//
// ponytail: detection is by hostname rather than a second
// ERROR_TRACKING_WEBHOOK_FORMAT env var. Both vendors have fixed, well-known
// webhook hostnames, so the env var would only ever restate what the URL
// already says. A Slack webhook proxied through your own domain is the one
// case this cannot see; it falls back to the generic JSON shape, which is the
// safe direction to be wrong in. Add the override then, not now.

export type WebhookFlavour = 'slack' | 'discord' | 'json';

// `message`/`stack` are typed `unknown` because that is what `redact()`
// returns. At runtime they are a string (its input is one), but there is no
// cast here to say so — the renderer normalizes instead, so a future redact()
// that returns something else cannot produce "[object Object]" in an alert.
export interface CapturedErrorPayload {
  message: unknown;
  stack?: unknown;
  requestId?: string;
  shopId?: number;
  route?: string;
  method?: string;
  capturedAt: string;
}

const SLACK_HOSTS = ['hooks.slack.com'];
const DISCORD_HOSTS = [
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
];

// Discord hard-rejects a `content` over 2000 characters; Slack's own limit is
// far higher but a wall of stack in a chat channel is unreadable either way.
const MAX_TEXT: Record<'slack' | 'discord', number> = {
  slack: 3500,
  discord: 1900,
};
const STACK_FRAMES = 6;

function hostMatches(hostname: string, hosts: string[]): boolean {
  return hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

export function detectWebhookFlavour(url: string): WebhookFlavour {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // env-validation.ts already rejects a non-URL at boot, so this is only
    // reachable if that ever stops running first. Generic shape is the safe
    // fallback: it is what every non-chat destination wants anyway.
    return 'json';
  }
  if (hostMatches(hostname, SLACK_HOSTS)) return 'slack';
  if (hostMatches(hostname, DISCORD_HOSTS)) return 'discord';
  return 'json';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 15).trimEnd()}\n...[truncated]`;
}

// A stack's first line is the message, which is already the headline here, so
// it is dropped rather than printed twice. Cutting by frame instead of by
// character keeps the block from ending mid-path.
function topFrames(stack: string): string {
  return stack
    .split('\n')
    .slice(1, 1 + STACK_FRAMES)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

// One renderer for both chat destinations, deliberately using no bold/italic
// markup — Slack's mrkdwn (`*bold*`) and Discord's markdown (`**bold**`)
// disagree, while a plain line and a triple-backtick fence render correctly
// in both. The alarm emoji is a real character, not a `:shortcode:`, for the
// same reason.
export function renderErrorText(payload: CapturedErrorPayload): string {
  const where = [payload.method, payload.route].filter(Boolean).join(' ');
  const meta = [
    where || null,
    payload.shopId != null ? `shop ${payload.shopId}` : null,
    payload.requestId ? `req ${payload.requestId}` : null,
  ]
    .filter(Boolean)
    .join('  |  ');

  const lines = ['\u{1F6A8} Requital backend error'];
  if (meta) lines.push(meta);
  lines.push(
    typeof payload.message === 'string'
      ? payload.message
      : JSON.stringify(payload.message),
  );
  if (typeof payload.stack === 'string') {
    const frames = topFrames(payload.stack);
    if (frames) lines.push(`\`\`\`\n${frames}\n\`\`\``);
  }
  return lines.join('\n');
}

export function buildWebhookBody(
  url: string,
  payload: CapturedErrorPayload,
): unknown {
  const flavour = detectWebhookFlavour(url);
  if (flavour === 'json') return payload;
  const text = truncate(renderErrorText(payload), MAX_TEXT[flavour]);
  return flavour === 'slack' ? { text } : { content: text };
}
