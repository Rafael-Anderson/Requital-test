import { Controller, Get, Param, ParseIntPipe, Redirect } from '@nestjs/common';
import { BioLinksService } from './bio-links.service';
import { Public } from '../auth/decorators/public.decorator';

// A global bio-link id, not shop-slug-scoped in the URL (the shop is
// resolved from the link itself) — doesn't fit PublicController's
// `public/:shopSlug/...` shape, same reasoning as PublicShopsController
// getting its own slim controller instead of being crammed in there.
@Controller('public/bio-links')
export class PublicBioLinksController {
  constructor(private readonly bioLinksService: BioLinksService) {}

  @Public()
  @Get(':id/click')
  @Redirect()
  async click(@Param('id', ParseIntPipe) id: number) {
    const url = await this.bioLinksService.resolveClickTarget(id);
    return { url, statusCode: 302 };
  }
}
