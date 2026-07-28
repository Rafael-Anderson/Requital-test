export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Display name in the From header — e.g. a shop's own name — even though
  // the sending address/domain is always the platform's (see
  // common/email.ts's class comment for why platform-level, not per-shop).
  fromName: string;
  // Platform-level Resend API key, resolved by common/email.ts from
  // RESEND_API_KEY — same bring-your-own-credentials shape as
  // WhatsAppProvider's `credentials` field, even though (unlike WhatsApp)
  // there's only ever one value: the platform's, never a per-shop override.
  // Kept as an explicit param rather than read from process.env inside the
  // provider so the provider itself stays trivially testable without
  // mutating global env.
  credentials: { apiKey: string };
}

export interface EmailSendResult {
  providerReference: string;
}

// Strategy interface, one active implementation (Resend) — mirrors
// whatsapp/whatsapp-provider.interface.ts's WhatsAppProvider shape. Unlike
// PaymentProvider there's no registry and no per-shop credential
// resolution: email sending is platform-level only (see the "Real email
// delivery" report — avoids merchants needing their own DNS/SPF/DKIM
// setup), so nothing chooses among providers or credentials at call time.
export interface EmailProvider {
  readonly name: string;
  sendEmail(params: SendEmailParams): Promise<EmailSendResult>;
}
