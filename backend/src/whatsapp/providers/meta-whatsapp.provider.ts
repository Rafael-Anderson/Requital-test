import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  SendWhatsAppMessageParams,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../whatsapp-provider.interface';
import { sanitizeCredentialValue } from '../../common/credential-sanitize';
import {
  MetaGraphError,
  friendlyMetaError,
  parseMetaError,
} from '../meta-graph-error';

const GRAPH_API_VERSION = 'v21.0';

interface MetaSendResponse {
  messages?: { id: string }[];
}

export interface WhatsAppPhoneNumberInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

// Sanitised here, at the one place every send goes through (per-shop and the
// platform alerts alike): a value stored before the save-time clean-up still
// works. See common/credential-sanitize.ts.
function cleanCredentials(credentials: Record<string, string>) {
  return {
    phoneNumberId: sanitizeCredentialValue(credentials.phoneNumberId ?? ''),
    accessToken: sanitizeCredentialValue(credentials.accessToken ?? ''),
  };
}

async function throwMetaError(res: Response): Promise<never> {
  const details = parseMetaError(res.status, await res.text());
  throw new MetaGraphError(friendlyMetaError(details));
}

// Real implementation against Meta's WhatsApp Cloud API — the direct path
// (no BSP/reseller middleman). Credentials: { phoneNumberId, accessToken },
// entered by the merchant via WhatsAppSettingsController/admin Settings UI
// (Meta's own business verification/onboarding happens entirely outside
// this app — see the task's scope note, no in-app wizard).
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';

  async sendMessage(
    params: SendWhatsAppMessageParams,
  ): Promise<WhatsAppSendResult> {
    const { phoneNumberId, accessToken } = cleanCredentials(params.credentials);
    if (!phoneNumberId || !accessToken) {
      throw new InternalServerErrorException(
        'Meta WhatsApp Cloud API credentials are incomplete for this shop',
      );
    }

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // Cloud API wants the E.164 number without the leading '+'.
          to: params.to.replace(/^\+/, ''),
          type: 'text',
          text: { body: params.body },
        }),
      },
    );

    if (!res.ok) await throwMetaError(res);

    const data = (await res.json()) as MetaSendResponse;
    return { providerReference: data.messages?.[0]?.id ?? '' };
  }

  // Test connection: a harmless read of the phone number's own record. Sends
  // nothing to anyone.
  async describePhoneNumber(
    credentials: Record<string, string>,
  ): Promise<WhatsAppPhoneNumberInfo> {
    const { phoneNumberId, accessToken } = cleanCredentials(credentials);
    if (!phoneNumberId || !accessToken) {
      throw new InternalServerErrorException(
        'Meta WhatsApp Cloud API credentials are incomplete for this shop',
      );
    }
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) await throwMetaError(res);
    const data = (await res.json()) as {
      display_phone_number?: unknown;
      verified_name?: unknown;
    };
    return {
      displayPhoneNumber:
        typeof data.display_phone_number === 'string'
          ? data.display_phone_number
          : null,
      verifiedName:
        typeof data.verified_name === 'string' ? data.verified_name : null,
    };
  }
}
