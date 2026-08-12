import { ResendEmailProvider } from '../email/providers/resend-email.provider';
import { createLogger } from './logging/logger';

const logger = createLogger('Email');

// STUB: used when RESEND_API_KEY isn't configured (local dev, or a
// deployment that hasn't set up real sending yet) — logs instead of
// actually sending, so every call site is visibly a stub rather than a
// silent no-op that looks like it worked. Also the fallback sendEmail()
// below reaches for when the real provider call itself fails (invalid key,
// unverified domain, network error) — never crashes the caller either way.
//
// Deliberately still a raw console.log, not the structured logger (Phase 4
// ops foundations) — allowlisted in tools/check-no-console-log.js. This is
// a dev-visibility placeholder meant to be eyeballed in a terminal, not an
// operational error/warning the ops-logging pipeline needs to capture, and
// dozens of existing e2e specs (order-notifications, survey) plus
// email.spec.ts itself spy on console.log specifically to verify stub
// behavior — converting this to JSON-on-stdout would mean spying on
// process.stdout.write instead, which risks swallowing Jest's own reporter
// output. Not worth the churn for a purely cosmetic format change.
export function sendEmailStub(
  to: string,
  subject: string,
  bodyText: string,
): void {
  console.log(`[email:stub] to=${to} subject="${subject}"\n${bodyText}`);
}

// Exported for reuse by every call site's own HTML email template (see
// auth.service.ts, order-notifications.service.ts, etc.) — a pure escaping
// utility, not a template, so sharing it doesn't create the
// one-email-type-breaks-another risk a shared *render* function would.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Every existing call site only ever built a plain-text bodyText — there are
// no HTML templates anywhere in this codebase yet, and hand-authoring one
// per email type is real future scope (see the "Real email delivery"
// report's scope note), not this pass. This derives a minimal HTML part
// from the same text every caller already builds — paragraphs preserved,
// bare URLs turned into clickable links — so every send is multipart
// (better deliverability/accessibility) without redesigning content that
// isn't broken.
function textToSimpleHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((block) =>
      escapeHtml(block)
        .replace(
          /(https?:\/\/\S+)/g,
          '<a href="$1" style="color:#069494;">$1</a>',
        )
        .replace(/\n/g, '<br>'),
    )
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#111;">${p}</p>`,
    )
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">${paragraphs}</div>`;
}

interface SendEmailOptions {
  html?: string;
  // Display name in the From header. Defaults to "Requital" — right for the
  // platform-facing emails (staff invite/reset/verify, where the recipient
  // IS the shop owner logging into Requital itself), overridden with the
  // shop's own name at customer-facing call sites (order notifications,
  // abandoned cart, gift card) so those read as coming from the shop, not
  // the platform, even though the sending domain is always the platform's.
  fromName?: string;
}

// Same real-vs-stub resolution as sendEmail() below, but lets a real
// delivery failure propagate instead of swallowing it. Used by the Phase 5
// job queue's send_email handler (jobs/handlers/send-email.handler.ts) —
// letting the failure throw is what gives the queue's retry/backoff/DLQ
// something real to act on; every other (non-queued) code path should keep
// using sendEmail() below.
export async function sendEmailOrThrow(
  to: string,
  subject: string,
  bodyText: string,
  options: SendEmailOptions = {},
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  // 'test' is a reserved sentinel, not a real key format (real Resend keys
  // are always 're_...') — set RESEND_API_KEY=test in a dev/e2e .env to
  // short-circuit straight to the stub, same "network-independent test
  // gateway" reasoning as the payment providers'
  // PaymentProviderNotConfiguredException fallback. Without this, every
  // e2e spec that signs up a shop (which fires a real verification email)
  // makes a real network call to Resend that reliably fails in this sandbox
  // anyway (Resend only delivers to the account owner's own address) —
  // that real round-trip, multiplied across dozens of specs, is what was
  // making the e2e suite flaky under load.
  if (!apiKey || apiKey === 'test') {
    sendEmailStub(to, subject, bodyText);
    return;
  }
  await new ResendEmailProvider().sendEmail({
    to,
    subject,
    text: bodyText,
    html: options.html ?? textToSimpleHtml(bodyText),
    fromName: options.fromName ?? 'Requital',
    credentials: { apiKey },
  });
}

// The single entry point every non-queued call site uses instead of
// sendEmailStub directly — resolves to the real Resend provider when
// RESEND_API_KEY is configured, otherwise degrades to the stub. Never
// throws: a broken or misconfigured provider must not fail the caller it
// was invoked from, same discipline as AuditLogService.log and
// OrderNotificationsService.sendWhatsApp. As of Phase 5, every real
// transactional-email call site routes through the job queue instead (see
// jobs/handlers/send-email.handler.ts, which calls sendEmailOrThrow above)
// — this wrapper is kept as the safe direct-call option for anything that
// isn't queued.
export async function sendEmail(
  to: string,
  subject: string,
  bodyText: string,
  options: SendEmailOptions = {},
): Promise<void> {
  try {
    await sendEmailOrThrow(to, subject, bodyText, options);
  } catch (err) {
    logger.error(`send to ${to} failed, falling back to stub`, {
      error: err instanceof Error ? err.message : String(err),
    });
    sendEmailStub(to, subject, bodyText);
  }
}
