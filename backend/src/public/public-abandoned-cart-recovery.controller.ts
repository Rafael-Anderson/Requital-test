import { Controller, Get, Query } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';

// Separate from PublicController (shopSlug-scoped) for the same reason as
// PublicOrderLookupController: recoverToken is globally unique and
// self-sufficient — no shopSlug in the URL needed or wanted here.
@Controller('public/abandoned-carts')
export class PublicAbandonedCartRecoveryController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get('recover')
  recover(@Query('token') token?: string) {
    return this.publicService.recoverAbandonedCart(token ?? '');
  }
}
