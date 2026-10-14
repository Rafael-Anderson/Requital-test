import { Controller, Get, Header, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';

// Separate from PublicController (which is shop-slug-scoped) since a
// tracking token is globally unique and self-sufficient — no shopSlug in
// the URL needed or wanted here.
@Controller('public/orders')
export class PublicOrderLookupController {
  constructor(private readonly publicService: PublicService) {}

  // 60/min per client: the confirmation page polls about 30/min worst case. The
  // response is the customer's own order, so it is never cached.
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @Get('lookup')
  lookup(@Query('token') token?: string, @Query('shop') shop?: string) {
    return this.publicService.lookupOrder(token, shop);
  }
}
