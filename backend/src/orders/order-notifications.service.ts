import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FeaturesService } from '../features/features.service';
import type { RowDataPacket } from 'mysql2/promise';
import { sendWhatsAppStub } from '../common/whatsapp';
import { normalizePhoneToE164 } from '../common/phone';
import { generateSurveyToken } from '../common/token-hash';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { escapeHtml } from '../common/email';
import { WhatsAppSettingsService } from '../whatsapp/whatsapp-settings.service';
import { MetaWhatsAppProvider } from '../whatsapp/providers/meta-whatsapp.provider';
import { createLogger } from '../common/logging/logger';
import { JobsService } from '../jobs/jobs.service';
import { formatMoney } from '../common/money-format';
import { storefrontUrl } from '../common/storefront-url';

const logger = createLogger('OrderNotifications');

// Same env-driven storefront base URL every other customer-facing email
// link uses — see e.g. customer-auth.service.ts's reset-password link.

interface NotifiableOrder {
  id: number;
  // What the customer sees. `id` is still used for the job idempotency keys and
  // every lookup in this file - only the rendered "#N" changes.
  shopOrderNumber: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  orderType: string | null;
  total: string;
  // The order's own captured currency (A1), not the shop's current setting:
  // a notification about a past order has to state what that order was
  // actually priced in.
  currency: string;
  outletId: number;
}

// Customer-facing order notifications, email and WhatsApp — independent
// channels, gated by separate shop toggles, one failing must never block
// the other or the order operation these are called from.
//
// TOGGLE-SEMANTICS FINDING (WhatsApp extension): Business Settings has two
// WhatsApp toggles — "Allow WhatsApp Notifications" (shop.notifyWhatsapp)
// and "Notify Customers via WhatsApp" (shop.notifyCustomersWhatsapp). They
// are NOT duplicates. shop.notifyWhatsapp sits next to
// whatsappCountryCode/whatsappNumber — the shop's OWN WhatsApp contact
// number, confirmed elsewhere in the schema (see bio-link social-platform
// resolution) to be the merchant's own "chat with us" contact link, not a
// notification-sending concern at all. notifyCustomersWhatsapp is the only
// one whose name and label unambiguously say "notify customers" — that's
// the toggle gating everything below. notifyWhatsapp is left untouched by
// this feature; whatever it's meant to eventually control (most likely
// showing/enabling the shop's own WhatsApp contact channel) is out of scope
// here, and it was exactly as dead before this change as notifyEmail was
// before #12 — not a duplicate, just a second still-unwired setting.
//
// Email is queued via JobsService (Phase 5) — the send_email job handler
// resolves to the real Resend provider when RESEND_API_KEY is configured
// (platform-level, see the "Real email delivery" report), otherwise the
// stub, with real delivery failures retried by the queue instead of being
// swallowed inline. WhatsApp stays synchronous: calls the real Meta Cloud
// API provider when a shop has configured credentials
// (WhatsAppSettingsService), otherwise falls back to sendWhatsAppStub —
// never fails order creation/status updates either way.
@Injectable()
export class OrderNotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly whatsAppSettingsService: WhatsAppSettingsService,
    private readonly metaWhatsAppProvider: MetaWhatsAppProvider,
    private readonly jobsService: JobsService,
    private readonly features: FeaturesService,
  ) {}

  async notifyOrderConfirmed(shopId: number, order: NotifiableOrder) {
    const bodyText = `Hi ${order.customerName}, we've received your order #${order.shopOrderNumber} (total ${formatMoney(order.total, order.currency)}). We'll message you again once it's on its way.`;
    // Standalone literal, not shared with notifyOutForDelivery's own HTML
    // below — deliberately duplicated rather than factored into a common
    // renderer, so a future change to one order email type can't silently
    // alter another's markup.
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(order.customerName)},</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#111111;">We've received your order <strong>#${order.shopOrderNumber}</strong> (total ${escapeHtml(formatMoney(order.total, order.currency))}). We'll message you again once it's on its way.</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await Promise.all([
      this.sendEmail(
        shopId,
        order,
        `Order confirmation — #${order.shopOrderNumber}`,
        bodyText,
        html,
        `order:${order.id}:confirmed-email`,
      ),
      this.sendWhatsApp(shopId, order, bodyText),
      this.sendMerchantAlert(shopId, order),
    ]);
  }

  async notifyOutForDelivery(shopId: number, order: NotifiableOrder) {
    const isPickup = order.orderType === 'pickup';
    const subject = isPickup
      ? `Your order #${order.shopOrderNumber} is ready for pickup`
      : `Your order #${order.shopOrderNumber} is out for delivery`;
    const bodyText = isPickup
      ? `Hi ${order.customerName}, order #${order.shopOrderNumber} is ready for pickup at your selected outlet.`
      : `Hi ${order.customerName}, order #${order.shopOrderNumber} is on its way to you now.`;
    const messageHtml = isPickup
      ? `Order <strong>#${order.shopOrderNumber}</strong> is ready for pickup at your selected outlet.`
      : `Order <strong>#${order.shopOrderNumber}</strong> is on its way to you now.`;
    // Standalone literal (see notifyOrderConfirmed's own comment above) —
    // the pickup/delivery wording branch lives inside this one email type's
    // own template, not shared across types.
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(order.customerName)},</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#111111;">${messageHtml}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await Promise.all([
      this.sendEmail(
        shopId,
        order,
        subject,
        bodyText,
        html,
        `order:${order.id}:out-for-delivery-email`,
      ),
      this.sendWhatsApp(shopId, order, bodyText),
    ]);
  }

  // Fired once when an order reaches 'delivered' (see OrdersService.updateStatus),
  // gated on shop.customerSurveyEnabled. Idempotent via surveyresponse's
  // @unique orderId — a bulkUpdateStatus retry or any repeated call for the
  // same order is a no-op, so this can never create two rows or send two
  // emails for one order. The row is created (and never retried later) even
  // if notifyEmail is off or the order has no customerEmail at that exact
  // moment — same "gated at the moment it happened, never retroactively
  // re-evaluated" discipline as ingredientsConsumedAt (see schema.prisma).
  async notifySurveyRequest(shopId: number, order: NotifiableOrder) {
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT subdomain, name, displayName,
              customDomain, customDomainStatus, domainType
         FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    const flags = await this.features.getFlags(shopId);
    if (!shop || !flags.customer_survey) return;

    const existingRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM surveyresponse WHERE orderId = ?`,
      [order.id],
    );
    if (existingRows.length > 0) return;

    // A token collision on the unique index is retried with a fresh token (it
    // cannot realistically happen at 128 bits; this keeps it from ever being a
    // lost survey). A duplicate ORDER means a concurrent call already created it.
    let token = generateSurveyToken();
    for (let attempt = 1; ; attempt++) {
      try {
        await this.db.execute(
          `INSERT INTO surveyresponse (shopId, orderId, token) VALUES (?, ?, ?)`,
          [shopId, order.id, token],
        );
        break;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        if (String((err as Error).message).includes('orderId_key')) return;
        if (attempt >= 3) throw err;
        token = generateSurveyToken();
      }
    }

    if (!flags.notify_email || !order.customerEmail) return;
    const link = storefrontUrl(
      {
        subdomain: shop.subdomain as string,
        domainType: shop.domainType as string | null,
        customDomain: shop.customDomain as string | null,
        customDomainStatus: shop.customDomainStatus as string | null,
      },
      `/survey?token=${token}`,
    );
    const shopDisplayName = (shop.displayName as string | null) ?? (shop.name as string);
    const surveyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(order.customerName)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">We'd love your feedback on order <strong>#${order.id}</strong> from ${escapeHtml(shopDisplayName)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Leave feedback</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopDisplayName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: order.customerEmail,
        subject: `How was your order? — #${order.id}`,
        bodyText: `Hi ${order.customerName}, we'd love your feedback on order #${order.shopOrderNumber}: ${link}`,
        html: surveyHtml,
        fromName: shopDisplayName,
      },
      `order:${order.id}:survey-email`,
    );
  }

  // Sent once, right after a customer submits a survey with the "you may show
  // my feedback" box ticked (never when they did not tick it). It restates
  // what they agreed to and carries the link back to the survey page, where
  // the Withdraw button lives (a GET link never withdraws by itself, so a mail
  // scanner that prefetches links cannot do it either). Same gating as the
  // survey request itself: notify_email on and an email address on the order.
  // Idempotent per survey response.
  async notifySurveyConsentGiven(
    shopId: number,
    surveyId: number,
    orderId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT s.token, o.customerEmail, o.customerName, o.shopOrderNumber,
              sh.subdomain, sh.name, sh.displayName,
              sh.customDomain, sh.customDomainStatus, sh.domainType
         FROM surveyresponse s
         JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
         JOIN shop sh ON sh.id = s.shopId
        WHERE s.id = ? AND s.shopId = ? AND s.orderId = ?`,
      [surveyId, shopId, orderId],
    );
    const row = rows[0];
    if (!row || !row.customerEmail) return;
    if (!(await this.features.isEnabled(shopId, 'notify_email'))) return;

    const link = storefrontUrl(
      {
        subdomain: row.subdomain as string,
        domainType: row.domainType as string | null,
        customDomain: row.customDomain as string | null,
        customDomainStatus: row.customDomainStatus as string | null,
      },
      `/survey?token=${row.token as string}`,
    );
    const shopDisplayName =
      (row.displayName as string | null) ?? (row.name as string);
    const customerName = row.customerName as string;
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(customerName)},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Thank you for your feedback on order <strong>#${row.shopOrderNumber as number}</strong> from ${escapeHtml(shopDisplayName)}.</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">You agreed that ${escapeHtml(shopDisplayName)} may show your feedback on its website, with your first name and last initial. You can withdraw that agreement at any time; it will stop being shown straight away.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Manage my feedback</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${escapeHtml(shopDisplayName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: row.customerEmail as string,
        subject: `Your feedback on order #${row.shopOrderNumber as number}`,
        bodyText: `Hi ${customerName}, thank you for your feedback. You agreed that ${shopDisplayName} may show it on its website, with your first name and last initial. You can withdraw that agreement at any time: ${link}`,
        html,
        fromName: shopDisplayName,
      },
      `survey:${surveyId}:consent-email`,
    );
  }

  private async sendEmail(
    shopId: number,
    order: NotifiableOrder,
    subject: string,
    bodyText: string,
    html: string,
    idempotencyKey: string,
  ) {
    if (!order.customerEmail) return;
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT name, displayName FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    if (!shop || !(await this.features.isEnabled(shopId, 'notify_email')))
      return;
    await this.jobsService.enqueue(
      shopId,
      'send_email',
      {
        to: order.customerEmail,
        subject,
        bodyText,
        html,
        fromName: (shop.displayName as string | null) ?? (shop.name as string),
      },
      idempotencyKey,
    );
  }

  // Never throws — a WhatsApp send failure (network error, bad credentials,
  // Meta API error) must not block the email channel above or the order
  // operation this was called from, same discipline as AuditLogService.log.
  private async sendWhatsApp(
    shopId: number,
    order: NotifiableOrder,
    bodyText: string,
  ) {
    try {
      if (!(await this.features.isEnabled(shopId, 'notify_customers_whatsapp')))
        return;
      const shopRows = await this.db.query<RowDataPacket[]>(
        `SELECT countryCode FROM shop WHERE id = ?`,
        [shopId],
      );

      // The customer's number is a local number of the shop's own country
      // (NULL country keeps the legacy +971 assumption, see common/phone.ts).
      const to = normalizePhoneToE164(
        order.customerPhone,
        shopRows[0].countryCode as string | null,
      );
      if (!to) {
        logger.warn(
          `order #${order.id}: customer phone could not be normalized to E.164 — skipping`,
          { orderId: order.id, shopId },
        );
        return;
      }

      const credentials =
        await this.whatsAppSettingsService.resolveCredentials(shopId);
      if (!credentials) {
        sendWhatsAppStub(to, bodyText);
        return;
      }
      await this.metaWhatsAppProvider.sendMessage({
        to,
        body: bodyText,
        credentials,
      });
    } catch (err) {
      logger.error(`order #${order.id}: WhatsApp notification failed`, {
        orderId: order.id,
        shopId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Platform-owned WhatsApp new-order alert to the merchant's own outlet —
  // Requital's own WhatsApp Business account, not merchant-configured (see
  // common/whatsapp.ts's sendPlatformWhatsAppAlertOrThrow and CLAUDE.md's
  // "WhatsApp order alerts (platform-owned)" note). Always on, no per-shop
  // toggle (the feature is "zero setup, it's just on") — never throws, same
  // discipline as sendWhatsApp above, so a bad outlet phone or a down
  // platform WhatsApp account can never block order creation or the other
  // two notification channels.
  private async sendMerchantAlert(shopId: number, order: NotifiableOrder) {
    try {
      const outletRows = await this.db.query<RowDataPacket[]>(
        `SELECT o.phone, o.whatsapp, s.countryCode
         FROM outlet o JOIN shop s ON s.id = o.shopId
         WHERE o.id = ? AND o.shopId = ?`,
        [order.outletId, shopId],
      );
      const outlet = outletRows[0];
      const rawPhone = outlet?.whatsapp || outlet?.phone;
      if (!rawPhone) return;

      const to = normalizePhoneToE164(
        rawPhone as string,
        outlet.countryCode as string | null,
      );
      if (!to) {
        logger.warn(
          `order #${order.id}: outlet phone could not be normalized to E.164 — skipping merchant alert`,
          { orderId: order.id, shopId },
        );
        return;
      }

      const body = `New order #${order.shopOrderNumber} from ${order.customerName}. Total: ${formatMoney(order.total, order.currency)}.`;
      await this.jobsService.enqueue(
        shopId,
        'send_merchant_whatsapp_alert',
        { to, body, orderId: order.id },
        `order:${order.id}:merchant-whatsapp-alert`,
      );
    } catch (err) {
      logger.error(
        `order #${order.id}: merchant WhatsApp alert enqueue failed`,
        {
          orderId: order.id,
          shopId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
}
