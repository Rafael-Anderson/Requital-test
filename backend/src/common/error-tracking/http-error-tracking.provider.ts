import type {
  ErrorContext,
  ErrorTrackingProvider,
} from './error-tracking.interface';
import { redact } from '../logging/redact';
import { createLogger } from '../logging/logger';

const logger = createLogger('ErrorTracking');

// Plain fetch POST to a configurable webhook URL — no vendor SDK dependency,
// same "no SDK, just fetch" pattern as ResendEmailProvider/
// MetaWhatsAppProvider elsewhere in this codebase. Works with Sentry's own
// generic webhook ingestion, a custom collector, or anything else that
// accepts a JSON POST — the point is the interface never names a vendor.
// Fire-and-forget: capturing an error must never itself throw or block the
// request that triggered it, same discipline as AuditLogService.log.
export class HttpErrorTrackingProvider implements ErrorTrackingProvider {
  constructor(private readonly webhookUrl: string) {}

  captureException(error: unknown, context: ErrorContext): void {
    const payload = {
      message: redact(error instanceof Error ? error.message : String(error)),
      stack: error instanceof Error ? redact(error.stack) : undefined,
      ...context,
      capturedAt: new Date().toISOString(),
    };
    fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err: unknown) => {
      logger.warn('failed to deliver captured exception to error-tracking webhook', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
