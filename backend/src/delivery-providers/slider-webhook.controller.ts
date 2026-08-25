import { Body, Controller, Headers, Post } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { Public } from '../auth/decorators/public.decorator';
import { createLogger } from '../common/logging/logger';
import { SLIDER_WEBHOOK_TOKEN_HEADER } from './slider/slider.constants';

const logger = createLogger('SliderWebhookController');

interface SliderWebhookPayload {
  order_number: number;
  order_id: number;
  status: string;
  estimated_delivery_time?: string | number | null;
  tracking_link?: string | null;
  driver_info?: {
    name?: string;
    phone_number?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  timestamp?: string | number;
}

// @Public — Slider calls this directly, no staff session involved. Auth is
// the shop's own optional webhook token (checked inside the queued job, see
// SliderWebhookJobHandler — not here, per "return 2xx immediately... do not
// do DB work before responding" below).
@Public()
@Controller('slider')
export class SliderWebhookController {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Body() body: SliderWebhookPayload,
    @Headers(SLIDER_WEBHOOK_TOKEN_HEADER) token: string | undefined,
  ) {
    const orderId = Number(body.order_id);
    const sliderOrderNumber = Number(body.order_number);
    if (!orderId || !sliderOrderNumber || !body.status) {
      // Malformed payload — ack anyway so Slider doesn't keep retrying
      // something that will never parse correctly.
      return { received: true };
    }

    // The one lookup this route needs before it can even enqueue (the job
    // queue requires a real shopId up front, see JobsService.enqueue) — a
    // single indexed-by-PK read, not the actual delivery/order update work,
    // which happens entirely inside the queued job.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT shopId FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    const shopId = rows[0]?.shopId as number | undefined;
    if (!shopId) {
      logger.warn('Slider webhook for unknown order, ignoring', { orderId });
      return { received: true };
    }

    await this.jobsService.enqueue(
      shopId,
      'process_slider_webhook',
      {
        shopId,
        orderId,
        sliderOrderNumber,
        status: body.status,
        trackingLink: body.tracking_link ?? null,
        estimatedDeliveryTime: body.estimated_delivery_time ?? null,
        driverInfo: body.driver_info ?? null,
        providedToken: token ?? null,
      },
      `slider-webhook-${orderId}-${sliderOrderNumber}-${body.status}-${body.timestamp ?? Date.now()}`,
    );

    return { received: true };
  }
}
