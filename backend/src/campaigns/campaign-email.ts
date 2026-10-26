import { escapeHtml } from '../common/email';

// MKT-1. Pure rendering of one campaign email. The body arrives ALREADY sanitised
// (common/sanitize-html.ts, at write time and again at send time); this file wraps
// it with the mandatory footer and derives the plain-text part.
//
// The footer is not optional and not part of the merchant's body: it names who is
// sending (the shop) and carries the opaque unsubscribe link. Every value put in
// it is escaped here.
export interface CampaignEmailInput {
  shopName: string;
  legalName?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  bodyHtml: string;
  unsubscribeUrl: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

// Sanitised HTML to readable text: block ends become line breaks, links keep their
// target in brackets, every other tag goes, the few entities the sanitiser can
// emit are decoded.
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_m, href, text) => {
      const label = String(text).replace(/<[^>]+>/g, '').trim();
      const target = String(href).replace(/&amp;/g, '&');
      return label && label !== target ? `${label} (${target})` : target;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderCampaignEmail(input: CampaignEmailInput): {
  html: string;
  text: string;
} {
  const identity = [input.legalName || input.shopName, input.address]
    .filter((p): p is string => !!p && p.trim() !== '')
    .map((p) => p.trim());
  const reason = `You are receiving this email because you agreed to receive marketing emails from ${input.shopName}.`;
  const unsub = `Unsubscribe: ${input.unsubscribeUrl}`;

  const footerHtml =
    `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0;">` +
    `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#555;">${escapeHtml(reason)}</p>` +
    `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#555;">${escapeHtml(identity.join(', '))}` +
    (input.contactEmail ? ` (${escapeHtml(input.contactEmail)})` : '') +
    `</p>` +
    `<p style="margin:0;font-size:12px;line-height:1.5;"><a href="${escapeHtml(input.unsubscribeUrl).replace(/"/g, '&quot;')}" style="color:#555;">Unsubscribe</a></p>`;

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;font-size:15px;line-height:1.5;color:#111;">` +
    input.bodyHtml +
    footerHtml +
    `</div>`;

  const text = [
    htmlToText(input.bodyHtml),
    '--',
    reason,
    identity.join(', ') + (input.contactEmail ? ` (${input.contactEmail})` : ''),
    unsub,
  ].join('\n\n');
  return { html, text };
}

// RFC 2369 / RFC 8058. Both the mailto-free https form and the One-Click companion.
// The URL is built server-side from our own origin and an opaque token; it is
// still stripped of anything that could end a header value.
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  const safe = oneClickUrl.replace(/[\s<>\u0000-\u001f]/g, '');
  return {
    'List-Unsubscribe': `<${safe}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
