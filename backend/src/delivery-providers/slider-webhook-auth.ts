import { timingSafeEqual } from 'crypto';

// Fail closed, not open: an unconfigured SLIDER_WEBHOOK_TOKEN used to mean
// "auth is optional, proceed unauthenticated" (see this file's own git
// history) — that let a forged webhook for a guessed order id process for
// real, including the collectCashIfCod cascade in
// SliderWebhookJobHandler.handle, if the env var was ever left unset. An
// unconfigured token now means every request is rejected, never accepted.
//
// Checked here, in the controller, before SliderWebhookController.handleWebhook
// enqueues anything — previously the token was only checked inside the
// queued job handler, so a forged request with no valid token still wrote a
// row into the job table before ever being rejected (see this file's own
// git history / the security audit finding this fixes).
export function verifySliderWebhookToken(
  providedToken: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !providedToken) return false;
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const providedBuf = Buffer.from(providedToken, 'utf8');
  // timingSafeEqual throws on a length mismatch rather than returning false
  // — checked explicitly first so a wrong-length token can't crash the
  // webhook endpoint or be distinguished from a wrong-value one by error
  // shape, matching the same pattern payments/webhook-signature.ts already
  // uses for Tabby/Tamara's HMAC comparison.
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
