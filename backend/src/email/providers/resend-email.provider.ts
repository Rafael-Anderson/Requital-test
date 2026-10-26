import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  EmailProvider,
  EmailSendResult,
  SendEmailParams,
} from '../email-provider.interface';
import {
  platformViaDisplayName,
  sanitizeDisplayName,
} from '../../sending-domains/sending-domain-validation';

const RESEND_API_URL = 'https://api.resend.com/emails';
const PLATFORM_FROM_ADDRESS = 'noreply@requital.io';

// Only well-formed header names pass, and a value loses every control character
// (CR/LF above all), so neither half can start a second header.
export function safeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) continue;
    // eslint-disable-next-line no-control-regex
    out[name] = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  }
  return Object.keys(out).length ? out : undefined;
}

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
        // The display name is sanitised (no CR/LF, quotes or angle brackets)
        // so a shop name can never inject a header or break out of the string.
        from: `"${params.viaPlatform && !params.fromAddress ? platformViaDisplayName(params.fromName) : sanitizeDisplayName(params.fromName)}" <${params.fromAddress ?? PLATFORM_FROM_ADDRESS}>`,
        // UNVERIFIED: Resend's field name for Reply-To is `reply_to`.
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        // UNVERIFIED: Resend's `headers` field carries custom headers as an object.
        ...(safeHeaders(params.headers) ? { headers: safeHeaders(params.headers) } : {}),
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
