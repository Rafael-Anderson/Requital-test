import { Module } from '@nestjs/common';
import { StorefrontSearchController } from './storefront-search.controller';
import { StorefrontSearchService } from './storefront-search.service';

@Module({
  controllers: [StorefrontSearchController],
  providers: [StorefrontSearchService],
})
export class StorefrontSearchModule {}
