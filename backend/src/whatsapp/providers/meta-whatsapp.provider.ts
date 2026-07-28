import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  SendWhatsAppMessageParams,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../whatsapp-provider.interface';

const GRAPH_API_VERSION = 'v21.0';

interface MetaSendResponse {
  messages?: { id: string }[];
}

// Real implementation against Meta's WhatsApp Cloud API — the direct path
// (no BSP/reseller middleman). Credentials: { phoneNumberId, accessToken },
// entered by the merchant via WhatsAppSettingsController/admin Settings UI
// (Meta's own business verification/onboarding happens entirely outside
// this app — see the task's scope note, no in-app wizard).
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';

  async sendMessage(params: SendWhatsAppMessageParams): Promise<WhatsAppSendResult> {
    const { phoneNumberId, accessToken } = params.credentials;
    if (!phoneNumberId || !accessToken) {
      throw new InternalServerErrorException(
        'Meta WhatsApp Cloud API credentials are incomplete for this shop',
      );
    }

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
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

    if (!res.ok) {
      const errorBody = await res.text();
      throw new InternalServerErrorException(
        `Meta WhatsApp Cloud API error (${res.status}): ${errorBody}`,
      );
    }

    const data = (await res.json()) as MetaSendResponse;
    return { providerReference: data.messages?.[0]?.id ?? '' };
  }
}
