export interface SendWhatsAppMessageParams {
  // E.164, e.g. +971501234567 — callers normalize before calling (see
  // common/phone.ts), this interface doesn't validate the shape itself.
  to: string;
  body: string;
  // Shop-level credentials resolved by WhatsAppSettingsService, same
  // bring-your-own-keys shape as PaymentProvider's CreateCheckoutSessionParams.
  // Undefined/null is the caller's signal to use sendWhatsAppStub instead —
  // this interface's implementations assume real credentials are present.
  credentials: Record<string, string>;
}

export interface WhatsAppSendResult {
  providerReference: string;
}

// Strategy interface, one active implementation (Meta WhatsApp Cloud API) —
// mirrors payments/payment-provider.interface.ts's PaymentProvider shape.
// Unlike PaymentProvider there's no registry: a shop doesn't choose among
// several WhatsApp providers, so OrderNotificationsService depends on the
// concrete MetaWhatsAppProvider directly.
export interface WhatsAppProvider {
  readonly name: string;
  sendMessage(params: SendWhatsAppMessageParams): Promise<WhatsAppSendResult>;
}
