import { sendPlatformWhatsAppAlertOrThrow } from '../../common/whatsapp';
import type { SendMerchantWhatsAppAlertJobPayload } from '../jobs.types';

// Deliberately uses sendPlatformWhatsAppAlertOrThrow, not a swallowing
// wrapper — a real delivery failure must propagate so JobsWorkerService can
// retry it with backoff and eventually dead-letter it. Same discipline as
// handleSendEmailJob.
export async function handleSendMerchantWhatsAppAlertJob(
  payload: SendMerchantWhatsAppAlertJobPayload,
): Promise<void> {
  await sendPlatformWhatsAppAlertOrThrow(payload.to, payload.body);
}
