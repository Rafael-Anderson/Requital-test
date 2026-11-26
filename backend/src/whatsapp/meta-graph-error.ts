// A failed call to Meta's Graph API, turned into something a merchant can act
// on. Meta answers { error: { message, type, code, error_subcode, fbtrace_id } }.
// What reaches the merchant: a friendly sentence for the common cases plus,
// under "details", Meta's own message and the fbtrace_id. Never the token (Meta
// does not echo it, and nothing here reads the request).

export interface MetaErrorDetails {
  metaMessage: string | null;
  fbtraceId: string | null;
  code: number | null;
  subcode: number | null;
  status: number;
}

export interface FriendlyMetaError {
  // A stable reason for the client to branch on.
  reason:
    | 'invalid_token'
    | 'phone_number_id_not_found'
    | 'missing_permission'
    | 'unknown';
  message: string;
  details: MetaErrorDetails;
}

interface MetaErrorBody {
  error?: {
    message?: unknown;
    code?: unknown;
    error_subcode?: unknown;
    fbtrace_id?: unknown;
  };
}

const MAX_META_MESSAGE = 300;

export function parseMetaError(
  status: number,
  rawBody: string,
): MetaErrorDetails {
  let body: MetaErrorBody | null = null;
  try {
    body = JSON.parse(rawBody) as MetaErrorBody;
  } catch {
    body = null;
  }
  const e = body?.error;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const message = str(e?.message);
  return {
    metaMessage: message ? message.slice(0, MAX_META_MESSAGE) : null,
    fbtraceId: str(e?.fbtrace_id),
    code: num(e?.code),
    subcode: num(e?.error_subcode),
    status,
  };
}

export function friendlyMetaError(
  details: MetaErrorDetails,
): FriendlyMetaError {
  const { code, subcode, status } = details;
  if (code === 190 || status === 401) {
    return {
      reason: 'invalid_token',
      message:
        'Meta rejected the access token: it is invalid or has expired. Create a new permanent token in Meta Business Manager and paste it again.',
      details,
    };
  }
  if (code === 100 && subcode === 33) {
    return {
      reason: 'phone_number_id_not_found',
      message:
        'Meta could not find this Phone Number ID, or this token cannot see it. Copy the Phone Number ID (digits only) from WhatsApp Manager > API Setup.',
      details,
    };
  }
  if (
    code === 10 ||
    code === 200 ||
    (code !== null && code >= 200 && code <= 299) ||
    status === 403
  ) {
    return {
      reason: 'missing_permission',
      message:
        'The access token does not have permission for this phone number. Give the system user the whatsapp_business_messaging and whatsapp_business_management permissions and assign it the WhatsApp account.',
      details,
    };
  }
  return {
    reason: 'unknown',
    message: 'Meta could not complete the request. See the details below.',
    details,
  };
}

// Thrown by MetaWhatsAppProvider for a non-2xx Graph API answer. `message` is
// the friendly sentence (safe to log and show); `friendly` carries the rest.
export class MetaGraphError extends Error {
  constructor(readonly friendly: FriendlyMetaError) {
    super(friendly.message);
    this.name = 'MetaGraphError';
  }
}
