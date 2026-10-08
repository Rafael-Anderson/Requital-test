import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductCatalogService } from './product-catalog.service';
import { ProductStockService } from './product-stock.service';
import { ProductImportService } from './product-import.service';
import { ProductShopifyImportService } from './product-shopify-import.service';
import { ProductImageCopyService } from './product-image-copy.service';
import { ProductBomService } from './product-bom.service';
import { ProductOrderItemsService } from './product-order-items.service';
import { ProductReadService } from './product-read.service';
import { LowStockDigestService } from './low-stock-digest.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { NotifySubscriptionsModule } from '../notify-subscriptions/notify-subscriptions.module';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { TaxClassesModule } from '../tax-classes/tax-classes.module';

@Module({
  imports: [
    AuditLogModule,
    BranchRolesModule,
    NotifySubscriptionsModule,
    JobsModule,
    StorageModule,
    DiscountsModule,
    TaxClassesModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductCatalogService,
    ProductStockService,
    ProductImportService,
    ProductShopifyImportService,
    ProductImageCopyService,
    ProductBomService,
    ProductOrderItemsService,
    ProductReadService,
    LowStockDigestService,
  ],
  // Consumed by OrdersModule/PublicModule for order-time variant resolution
  // (see ProductsService.resolveOrderItems) — one shared place for "does
  // this item need a variant, and what's its effective price/label", same
  // reuse pattern as AffiliateService.resolveAttribution.
  exports: [ProductsService, LowStockDigestService],
})
export class ProductsModule {}
