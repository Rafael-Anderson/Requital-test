import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CustomersModule } from '../customers/customers.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OrderNotificationsModule } from './order-notifications.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { NotifySubscriptionsModule } from '../notify-subscriptions/notify-subscriptions.module';

@Module({
  imports: [
    CustomersModule,
    AffiliateModule,
    ProductsModule,
    DiscountsModule,
    AuditLogModule,
    OrderNotificationsModule,
    BranchRolesModule,
    NotifySubscriptionsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
