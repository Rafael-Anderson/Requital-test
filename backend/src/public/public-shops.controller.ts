import { Controller, Get } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';

// Separate from PublicController (shop-slug-scoped, @Controller('public/:shopSlug'))
// for the same reason as PublicOrderLookupController: 'shops' would
// otherwise be swallowed as a literal shopSlug value by that controller's
// routes instead of reaching a dedicated handler here.
@Controller('public/shops')
export class PublicShopsController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get('sitemap')
  listForSitemap() {
    return this.publicService.listShopsForSitemap();
  }
}
