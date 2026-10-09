// CUS-11. The consent channels a customer can answer for, and the wording the
// STOREFRONT shows for each. The wording lives on the server, not in the client:
// the account page asks for it, shows it, and the server stamps the version and
// the full text onto the event, so a customer (or a forged request) can never
// attach a different sentence to a "granted".
export const CONSENT_CHANNELS = ['email', 'whatsapp', 'sms'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

// Where an answer came from. `import` and `checkout` are listed so the column's
// vocabulary is documented, but NOTHING in the codebase writes either: an import
// or a guest checkout never implies consent (that is the whole point of unknown
// being "no row"). The only writers are the admin and the customer's own account.
export const CONSENT_SOURCES = [
  'admin',
  'storefront_account',
  'account_deletion',
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

// Bump when ANY sentence below changes, so an older event still names the exact
// wording it was given under (the text is stored with each event as well).
export const CONSENT_WORDING_VERSION = '2026-10-v1';

const CHANNEL_NOUN: Record<ConsentChannel, string> = {
  email: 'emails',
  whatsapp: 'WhatsApp messages',
  sms: 'text messages (SMS)',
};

export function consentWordingText(
  channel: ConsentChannel,
  shopName: string,
): string {
  return `I agree to receive marketing ${CHANNEL_NOUN[channel]} from ${shopName}, such as offers and news. I can withdraw this at any time.`;
}

export function isConsentChannel(value: unknown): value is ConsentChannel {
  return (CONSENT_CHANNELS as readonly string[]).includes(value as string);
}
