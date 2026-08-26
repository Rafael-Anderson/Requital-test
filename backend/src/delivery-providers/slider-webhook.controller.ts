import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { Public } from '../auth/decorators/public.decorator';
import { createLogger } from '../common/logging/logger';
import { SLIDER_WEBHOOK_TOKEN_HEADER } from './slider/slider.constants';
import { verifySliderWebhookToken } from './slider-webhook-auth';

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
// the platform-wide webhook token, checked here, first, before any DB work
// or enqueue happens — previously this check lived inside the queued job
// handler, which meant a forged/unauthenticated request still wrote a row
// into the job table before ever being rejected (unbounded queue growth
// from an unauthenticated caller), and an unconfigured SLIDER_WEBHOOK_TOKEN
// meant "auth optional, process it anyway" rather than rejecting everything.
// Fixed: fail closed on a missing/wrong/unconfigured token, reject before
// any query runs. Legitimate requests still get the fast "queue it, do the
// real work off the request path" treatment — the token comparison itself
// is a few microseconds, it doesn't reintroduce the slow-response problem
// this design was built to avoid.
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
    if (!verifySliderWebhookToken(token, process.env.SLIDER_WEBHOOK_TOKEN)) {
      logger.warn('Slider webhook rejected: missing or invalid token');
      throw new UnauthorizedException('Invalid webhook token');
    }

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
      },
      `slider-webhook-${orderId}-${sliderOrderNumber}-${body.status}-${body.timestamp ?? Date.now()}`,
    );

    return { received: true };
  }
}
