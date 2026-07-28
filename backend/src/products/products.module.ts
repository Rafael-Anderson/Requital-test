import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { LowStockDigestService } from './low-stock-digest.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [ProductsController],
  providers: [ProductsService, LowStockDigestService],
  // Consumed by OrdersModule/PublicModule for order-time variant resolution
  // (see ProductsService.resolveOrderItems) — one shared place for "does
  // this item need a variant, and what's its effective price/label", same
  // reuse pattern as AffiliateService.resolveAttribution.
  exports: [ProductsService, LowStockDigestService],
})
export class ProductsModule {}
