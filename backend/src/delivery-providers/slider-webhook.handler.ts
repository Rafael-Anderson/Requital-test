import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { ExternalDeliveriesService } from '../external-deliveries/external-deliveries.service';
import { WebhookLogService } from '../webhook-log/webhook-log.service';
import { mapSliderStatus } from './slider/slider-status-map';
import { createLogger } from '../common/logging/logger';
import type { TenantContext } from '../common/tenant-context';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { ProcessSliderWebhookJobPayload } from '../jobs/jobs.types';

const logger = createLogger('SliderWebhookHandler');

function parseEstimatedMinutes(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return Math.round(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMinutes = Math.round((parsed.getTime() - Date.now()) / 60_000);
  return diffMinutes > 0 ? diffMinutes : null;
}

// The real work behind the Slider webhook — deliberately run inside the job
// queue (see jobs.worker.service.ts's HANDLERS wiring), not inline in the
// controller, so the webhook response is never blocked on DB work or on the
// COD/cash-collected cascade below. Registered as a Nest @Injectable (unlike
// the plain-function email/WhatsApp handlers) because this one genuinely
// needs DB access and OrdersService — see JobsWorkerService's constructor
// for how its handler map now resolves an instance-bound handler for this
// job type alongside the two static-function ones.
@Injectable()
export class SliderWebhookJobHandler implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly ordersService: OrdersService,
    private readonly externalDeliveriesService: ExternalDeliveriesService,
    private readonly webhookLogService: WebhookLogService,
    private readonly jobsWorkerService: JobsWorkerService,
  ) {}

  onModuleInit(): void {
    this.jobsWorkerService.registerHandler(
      'process_slider_webhook',
      (payload) => this.handle(payload as ProcessSliderWebhookJobPayload),
    );
  }

  async handle(payload: ProcessSliderWebhookJobPayload): Promise<void> {
    // Token verification happens in SliderWebhookController, before this
    // job is ever enqueued — a job only exists here because the request
    // that created it already passed that check. See
    // slider-webhook-auth.ts's own comment for why this moved (a
    // security-audit finding: the old "check inside the job" design let an
    // unauthenticated request grow the job table before ever being
    // rejected, and let an unconfigured token mean "proceed anyway").
    const status = mapSliderStatus(payload.status);
    const driver = payload.driverInfo;
    await this.externalDeliveriesService.updateSliderDeliveryByOrderNumber(
      payload.sliderOrderNumber,
      {
        status,
        driverName: driver?.name ?? undefined,
        driverPhone: driver?.phone_number ?? undefined,
        driverLat: driver?.latitude ?? undefined,
        driverLng: driver?.longitude ?? undefined,
        trackingUrl: payload.trackingLink ?? undefined,
        estimatedDeliveryMinutes: parseEstimatedMinutes(
          payload.estimatedDeliveryTime,
        ),
      },
    );
    await this.webhookLogService.log(
      payload.shopId,
      'slider',
      status,
      'success',
    );

    if (status === 'delivered') {
      await this.collectCashIfCod(payload.shopId, payload.orderId);
    }
    // 'cancelled'/'return_trip_started' need no side effect here — they're
    // surfaced to the merchant via StatusBadge's own color mapping on the
    // stored status (see admin StatusBadge.tsx), not a separate alert
    // channel; see the integration's own scope note for why a dedicated
    // notification wasn't built for this.
  }

  // Mirrors PaymentsService.applyAdvanceOrderStatus's synthesized-system-ctx
  // pattern verbatim — every shop always has at least one admin to
  // attribute this to (signup creates one, the last admin can never be
  // demoted/deleted). Swallows its own failure (already-collected,
  // non-COD, order not found) rather than failing the whole job — a
  // Slider 'delivered' event has already happened in the real world
  // regardless of whether our own cash-collected bookkeeping succeeds.
  private async collectCashIfCod(
    shopId: number,
    orderId: number,
  ): Promise<void> {
    const orderRows = await this.db.query<RowDataPacket[]>(
      `SELECT paymentMethod, cashCollectedAt FROM \`order\` WHERE id = ? AND shopId = ?`,
      [orderId, shopId],
    );
    const order = orderRows[0];
    if (
      !order ||
      order.paymentMethod !== 'cash_on_delivery' ||
      order.cashCollectedAt
    ) {
      return;
    }
    const adminRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    const admin = adminRows[0];
    if (!admin) {
      logger.warn(
        'Slider delivered webhook: no admin user to attribute cash-collected to',
        { shopId, orderId },
      );
      return;
    }
    const ctx: TenantContext = {
      userId: admin.id as number,
      shopId,
      role: 'admin',
      outletId: null,
    };
    try {
      await this.ordersService.collectCash(ctx, orderId);
    } catch (error) {
      logger.warn('Slider delivered webhook: collectCash failed', {
        shopId,
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
