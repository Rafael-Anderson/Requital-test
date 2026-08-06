import { Module } from '@nestjs/common';
import { GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [GiftCardsController],
  providers: [GiftCardsService],
  // Consumed by PublicModule for storefront redemption (validate/redeem)
  // and purchase issuance (issueForOrder), and by ReturnsModule for
  // refund-to-balance crediting.
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
