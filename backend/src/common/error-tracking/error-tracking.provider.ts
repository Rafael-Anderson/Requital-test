import type { ErrorTrackingProvider } from './error-tracking.interface';
import { HttpErrorTrackingProvider } from './http-error-tracking.provider';
import { NoopErrorTrackingProvider } from './noop-error-tracking.provider';

// Resolved once at bootstrap (see main.ts), same "resolve by env presence"
// shape as sendEmail()'s RESEND_API_KEY check — no DI container involved
// since this only needs to exist before the app itself is constructed
// (the global exception filter needs an instance to be constructed with).
export function resolveErrorTrackingProvider(): ErrorTrackingProvider {
  const webhookUrl = process.env.ERROR_TRACKING_WEBHOOK_URL;
  if (webhookUrl) {
    return new HttpErrorTrackingProvider(webhookUrl);
  }
  return new NoopErrorTrackingProvider();
}
