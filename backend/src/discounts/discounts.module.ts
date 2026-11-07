import { CollectionsModule } from '../collections/collections.module';
import { Module } from '@nestjs/common';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule, CollectionsModule],
  controllers: [DiscountsController],
  providers: [DiscountsService],
  // Consumed by OrdersModule/PublicModule (order-time redemption) and
  // DraftOrdersModule (draft-order discount application) — same reuse
  // pattern as ProductsService.
  exports: [DiscountsService],
})
export class DiscountsModule {}
