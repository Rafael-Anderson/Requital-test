import {
  Controller,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../../auth/decorators/public.decorator';
import {
  ChannelIngestionService,
  ChannelWebhookRejectedException,
} from '../../channel-ingestion.service';
import { DELIVEROO_PROVIDER } from './deliveroo-channel.provider';

// Body cap for this route: the Express JSON parser already answers 413 above
// 100 KB before this handler runs; the explicit check keeps the cap even if that
// default is ever raised. An order bigger than this is still picked up by the
// polling fallback (Get Orders has no such limit).
export const DELIVEROO_MAX_BODY_BYTES = 100 * 1024;
// Per source IP, never per connection or location (those come from the
// unauthenticated body). 240/min is well above the sandbox's real traffic and
// still bounds a forged-delivery flood. INFERRED sizing; Deliveroo's egress IPs
// are not published here.
export const DELIVEROO_WEBHOOK_LIMIT = 240;

// The one unauthenticated Deliveroo entry point (Order Events webhook).
// Everything security-relevant happens in ChannelIngestionService.receive():
// route by the enabled unique routing key, verify the HMAC over the RAW bytes
// against that connection's secret, and only then write the durable inbox row.
// Every refusal is the core's identical 401; success is a bare 200 whether the
// delivery was new or a duplicate, so the sender learns nothing extra.
@Public()
@Controller('channels/deliveroo')
export class DeliverooWebhookController {
  constructor(private readonly ingestion: ChannelIngestionService) {}

  @Post('webhook')
  @HttpCode(200)
  @Throttle({ default: { limit: DELIVEROO_WEBHOOK_LIMIT, ttl: 60_000 } })
  async receive(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody;
    if (
      !Buffer.isBuffer(raw) ||
      raw.length === 0 ||
      raw.length > DELIVEROO_MAX_BODY_BYTES
    ) {
      throw new ChannelWebhookRejectedException();
    }
    await this.ingestion.receive({
      provider: DELIVEROO_PROVIDER,
      rawBody: raw,
      headers: req.headers,
    });
    return { received: true };
  }
}
