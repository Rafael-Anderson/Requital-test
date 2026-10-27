import { Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { CampaignUnsubscribeService } from './campaign-unsubscribe.service';

// Un-slugged, token-only, like the survey routes. GET only reads (so a mail scanner
// that opens the link cannot unsubscribe anyone); POST acts, and is also the target
// of the List-Unsubscribe-Post one-click header (the provider POSTs with a form
// body we ignore).
@Controller('public/campaigns')
export class PublicCampaignUnsubscribeController {
  constructor(private readonly service: CampaignUnsubscribeService) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Get('unsubscribe')
  lookup(@Query('token') token?: string) {
    return this.service.lookup(token);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('unsubscribe')
  unsubscribe(@Query('token') token?: string) {
    return this.service.unsubscribe(token);
  }
}
