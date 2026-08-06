// One entry per queued operation. Keep payloads plain JSON-serializable data
// (no class instances, no Decimal/Date objects) since they round-trip
// through the `job.payload` JSON column.
export type JobType = 'send_email';

export interface SendEmailJobPayload {
  to: string;
  subject: string;
  bodyText: string;
  fromName?: string;
  html?: string;
}

export type JobPayload = SendEmailJobPayload;
