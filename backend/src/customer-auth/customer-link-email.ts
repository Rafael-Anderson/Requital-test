import { escapeHtml } from '../common/email';

// The one HTML shell for the customer-facing "click this link" emails (password
// reset, email verification). Every interpolated value is escaped here; the link
// is built by storefrontUrl() from a hex token, never from user input.
export function renderCustomerLinkEmail(p: {
  greetingName: string;
  shopDisplayName: string;
  intro: string;
  buttonLabel: string;
  link: string;
  ignoreNote: string;
}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(p.greetingName)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">${escapeHtml(p.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${p.link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(p.buttonLabel)}</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${p.link}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(p.shopDisplayName)} via Requital. ${escapeHtml(p.ignoreNote)}</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
}
