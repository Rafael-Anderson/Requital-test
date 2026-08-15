import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  EmailProvider,
  EmailSendResult,
  SendEmailParams,
} from '../email-provider.interface';

const RESEND_API_URL = 'https://api.resend.com/emails';

interface ResendSendResponse {
  id?: string;
}

interface ResendErrorResponse {
  message?: string;
}

// Real implementation against Resend's HTTP API — plain fetch, same as
// MetaWhatsAppProvider, no SDK dependency added for what a single POST does.
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    const { apiKey } = params.credentials;
    if (!apiKey) {
      throw new InternalServerErrorException('Resend API key is missing');
    }

    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Requital <noreply@requital.io>',
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const errorBody = (await res
        .json()
        .catch(() => ({}))) as ResendErrorResponse;
      throw new InternalServerErrorException(
        `Resend API error (${res.status}): ${errorBody.message ?? 'unknown error'}`,
      );
    }

    const data = (await res.json()) as ResendSendResponse;
    return { providerReference: data.id ?? '' };
  }
}
