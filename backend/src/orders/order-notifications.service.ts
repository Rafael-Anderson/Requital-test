import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sendEmail as sendEmailReal } from '../common/email';
import { sendWhatsAppStub } from '../common/whatsapp';
import { normalizePhoneToE164 } from '../common/phone';
import { generateSurveyToken } from '../common/token-hash';
import { WhatsAppSettingsService } from '../whatsapp/whatsapp-settings.service';
import { MetaWhatsAppProvider } from '../whatsapp/providers/meta-whatsapp.provider';
import { createLogger } from '../common/logging/logger';

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
  total: Prisma.Decimal | string;
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
// Email routes through common/email.ts's sendEmail() — the real Resend
// provider when RESEND_API_KEY is configured (platform-level, see the "Real
// email delivery" report), otherwise the stub. WhatsApp calls the real Meta
// Cloud API provider when a shop has configured credentials
// (WhatsAppSettingsService), otherwise falls back to sendWhatsAppStub —
// never fails order creation/status updates either way.
@Injectable()
export class OrderNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppSettingsService: WhatsAppSettingsService,
    private readonly metaWhatsAppProvider: MetaWhatsAppProvider,
  ) {}

  async notifyOrderConfirmed(shopId: number, order: NotifiableOrder) {
    const bodyText = `Hi ${order.customerName}, we've received your order #${order.id} (total ${order.total} AED). We'll message you again once it's on its way.`;
    await Promise.all([
      this.sendEmail(
        shopId,
        order,
        `Order confirmation — #${order.id}`,
        bodyText,
      ),
      this.sendWhatsApp(shopId, order, bodyText),
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
    await Promise.all([
      this.sendEmail(shopId, order, subject, bodyText),
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
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        customerSurveyEnabled: true,
        notifyEmail: true,
        subdomain: true,
        name: true,
        displayName: true,
      },
    });
    if (!shop?.customerSurveyEnabled) return;

    const existing = await this.prisma.surveyresponse.findUnique({
      where: { orderId: order.id },
    });
    if (existing) return;

    const token = generateSurveyToken();
    await this.prisma.surveyresponse.create({
      data: { shopId, orderId: order.id, token },
    });

    if (!shop.notifyEmail || !order.customerEmail) return;
    const link = `${STOREFRONT_URL}/${shop.subdomain}/survey?token=${token}`;
    await sendEmailReal(
      order.customerEmail,
      `How was your order? — #${order.id}`,
      `Hi ${order.customerName}, we'd love your feedback on order #${order.id}: ${link}`,
      { fromName: shop.displayName ?? shop.name },
    );
  }

  private async sendEmail(
    shopId: number,
    order: NotifiableOrder,
    subject: string,
    bodyText: string,
  ) {
    if (!order.customerEmail) return;
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { notifyEmail: true, name: true, displayName: true },
    });
    if (!shop?.notifyEmail) return;
    await sendEmailReal(order.customerEmail, subject, bodyText, {
      fromName: shop.displayName ?? shop.name,
    });
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
      const shop = await this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { notifyCustomersWhatsapp: true },
      });
      if (!shop?.notifyCustomersWhatsapp) return;

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
}
