import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { DraftPayService } from './draft-pay.service';

// The customer's pay page for an admin custom order: /pay/<token> on the
// shop's own storefront. No login; the 128-bit token is the credential and
// is valid only under its own shop's slug. Rate-limited per client.
@Public()
@Controller('public/:shopSlug/custom-orders/pay')
export class DraftPayController {
  constructor(private readonly pay: DraftPayService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  summary(@Param('shopSlug') shopSlug: string, @Param('token') token: string) {
    return this.pay.summary(shopSlug, token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':token/session')
  session(@Param('shopSlug') shopSlug: string, @Param('token') token: string) {
    return this.pay.createSession(shopSlug, token);
  }
}
