// Mirrored by hand in admin/lib/types.ts, same tradeoff as
// payments/provider-credentials.ts's PROVIDER_CREDENTIAL_FIELDS.
export interface WhatsAppCredentialFieldDef {
  key: string;
  label: string;
}

export const WHATSAPP_CREDENTIAL_FIELDS: WhatsAppCredentialFieldDef[] = [
  { key: 'phoneNumberId', label: 'Phone Number ID' },
  { key: 'accessToken', label: 'Access Token' },
];
