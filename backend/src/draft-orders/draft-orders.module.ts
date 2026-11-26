import { CollectionsModule } from '../collections/collections.module';
import { Module } from '@nestjs/common';
import {
  DiscountValidationController,
  DraftOrdersController,
} from './draft-orders.controller';
import { DraftOrdersService } from './draft-orders.service';
import { DraftPricingService } from './draft-pricing.service';
import { DraftPayService } from './draft-pay.service';
import { DraftPayController } from './draft-pay.controller';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { RegionsModule } from '../regions/regions.module';
import { PublicModule } from '../public/public.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrderNotificationsModule } from '../orders/order-notifications.module';

@Module({
  imports: [
    ProductsModule,
    DiscountsModule,
    OrdersModule,
    PaymentsModule,
    RegionsModule,
    CollectionsModule,
    PublicModule,
    BranchRolesModule,
    AuditLogModule,
    JobsModule,
    OrderNotificationsModule,
  ],
  controllers: [
    DraftOrdersController,
    DiscountValidationController,
    DraftPayController,
  ],
  providers: [DraftOrdersService, DraftPricingService, DraftPayService],
})
export class DraftOrdersModule {}
