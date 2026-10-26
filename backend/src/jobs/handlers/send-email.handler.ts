import { sendEmailOrThrow } from '../../common/email';
import type { SendEmailJobPayload } from '../jobs.types';

// Deliberately uses sendEmailOrThrow, not sendEmail() — a real delivery
// failure must propagate so JobsWorkerService can retry it with backoff and
// eventually dead-letter it, rather than being silently swallowed into the
// stub fallback the way every inline call site used to. The
// unset-key/'test'-sentinel stub path (local dev, CI) is unaffected — that
// branch inside sendEmailOrThrow still returns normally, so those jobs
// still "succeed" on the first attempt exactly as they did inline before.
export async function handleSendEmailJob(
  payload: SendEmailJobPayload,
  shopId?: number,
): Promise<void> {
  await sendEmailOrThrow(payload.to, payload.subject, payload.bodyText, {
    fromName: payload.fromName,
    html: payload.html,
    sensitive: payload.sensitive,
    // The job row's own shopId (never the payload's): picks the shop's verified
    // sending domain, and only for mail that names the shop as sender.
    shopId,
  });
}
