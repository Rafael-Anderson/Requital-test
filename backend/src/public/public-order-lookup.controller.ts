import { Controller, Get, Query } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';

// Separate from PublicController (which is shop-slug-scoped) since a
// tracking token is globally unique and self-sufficient — no shopSlug in
// the URL needed or wanted here.
@Controller('public/orders')
export class PublicOrderLookupController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get('lookup')
  lookup(@Query('token') token?: string) {
    return this.publicService.lookupOrder(token);
  }
}
