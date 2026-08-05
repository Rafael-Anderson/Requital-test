import type {
  ErrorContext,
  ErrorTrackingProvider,
} from './error-tracking.interface';
import { createLogger } from '../logging/logger';

const logger = createLogger('ErrorTracking');

// Default provider when no ERROR_TRACKING_WEBHOOK_URL is configured (local
// dev, or a deployment that hasn't set one up yet) — still visible in the
// structured JSON log stream (so nothing silently vanishes), just not
// forwarded anywhere external. Same "stub logs instead of a silent no-op"
// principle as sendEmailStub/MetaWhatsAppProvider's own stub.
export class NoopErrorTrackingProvider implements ErrorTrackingProvider {
  captureException(error: unknown, context: ErrorContext): void {
    logger.error('unhandled exception (no error-tracking sink configured)', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
