import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { StorefrontSearchService } from './storefront-search.service';

// A separate, narrow controller rather than a route on PublicController —
// same "own controller for a self-contained concern" pattern as
// PublicOrderLookupController/PublicSurveyController, just still
// shop-slug-scoped (this isn't a token-lookup feature) rather than
// tokenized like those two.
@Public()
@Controller('public/:shopSlug/search')
export class StorefrontSearchController {
  constructor(private readonly searchService: StorefrontSearchService) {}

  @Get()
  search(
    @Param('shopSlug') shopSlug: string,
    @Query('q') q: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    return this.searchService.search(shopSlug, q ?? '', cursor);
  }
}
