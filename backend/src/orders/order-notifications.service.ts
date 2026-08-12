import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { sendWhatsAppStub } from '../common/whatsapp';
import { normalizePhoneToE164 } from '../common/phone';
import { generateSurveyToken } from '../common/token-hash';
import { escapeHtml } from '../common/email';
import { WhatsAppSettingsService } from '../whatsapp/whatsapp-settings.service';
import { MetaWhatsAppProvider } from '../whatsapp/providers/meta-whatsapp.provider';
import { createLogger } from '../common/logging/logger';
import { JobsService } from '../jobs/jobs.service';

const logger = createLogger('OrderNotifications');

// Same env-driven storefront base URL every other customer-facing email
// link uses — see e.g. customer-auth.service.ts's reset-password link.
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

interface NotifiableOrder {
  id: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  orderType: string | null;
  total: string;
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
  ) {}

  async notifyOrderConfirmed(shopId: number, order: NotifiableOrder) {
    const bodyText = `Hi ${order.customerName}, we've received your order #${order.id} (total ${order.total} AED). We'll message you again once it's on its way.`;
    // Standalone literal, not shared with notifyOutForDelivery's own HTML
    // below — deliberately duplicated rather than factored into a common
    // renderer, so a future change to one order email type can't silently
    // alter another's markup.
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(order.customerName)},</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#111111;">We've received your order <strong>#${order.id}</strong> (total ${escapeHtml(order.total)} AED). We'll message you again once it's on its way.</p>
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
        `Order confirmation — #${order.id}`,
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
      ? `Your order #${order.id} is ready for pickup`
      : `Your order #${order.id} is out for delivery`;
    const bodyText = isPickup
      ? `Hi ${order.customerName}, order #${order.id} is ready for pickup at your selected outlet.`
      : `Hi ${order.customerName}, order #${order.id} is on its way to you now.`;
    const messageHtml = isPickup
      ? `Order <strong>#${order.id}</strong> is ready for pickup at your selected outlet.`
      : `Order <strong>#${order.id}</strong> is on its way to you now.`;
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
      `SELECT customerSurveyEnabled, notifyEmail, subdomain, name, displayName FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    if (!shop?.customerSurveyEnabled) return;

    const existingRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM surveyresponse WHERE orderId = ?`,
      [order.id],
    );
    if (existingRows.length > 0) return;

    const token = generateSurveyToken();
    await this.db.execute(
      `INSERT INTO surveyresponse (shopId, orderId, token) VALUES (?, ?, ?)`,
      [shopId, order.id, token],
    );

    if (!shop.notifyEmail || !order.customerEmail) return;
    const link = `${STOREFRONT_URL}/${shop.subdomain as string}/survey?token=${token}`;
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
        bodyText: `Hi ${order.customerName}, we'd love your feedback on order #${order.id}: ${link}`,
        html: surveyHtml,
        fromName: shopDisplayName,
      },
      `order:${order.id}:survey-email`,
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
      `SELECT notifyEmail, name, displayName FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    if (!shop?.notifyEmail) return;
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
      const shopRows = await this.db.query<RowDataPacket[]>(
        `SELECT notifyCustomersWhatsapp FROM shop WHERE id = ?`,
        [shopId],
      );
      if (!shopRows[0]?.notifyCustomersWhatsapp) return;

      const to = normalizePhoneToE164(order.customerPhone);
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
        `SELECT phone, whatsapp FROM outlet WHERE id = ?`,
        [order.outletId],
      );
      const outlet = outletRows[0];
      const rawPhone = outlet?.whatsapp || outlet?.phone;
      if (!rawPhone) return;

      const to = normalizePhoneToE164(rawPhone as string);
      if (!to) {
        logger.warn(
          `order #${order.id}: outlet phone could not be normalized to E.164 — skipping merchant alert`,
          { orderId: order.id, shopId },
        );
        return;
      }

      const body = `New order #${order.id} from ${order.customerName}. Total: ${order.total} AED.`;
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
