import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CustomersModule } from '../customers/customers.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OrderNotificationsModule } from './order-notifications.module';

@Module({
  imports: [
    CustomersModule,
    AffiliateModule,
    ProductsModule,
    DiscountsModule,
    AuditLogModule,
    OrderNotificationsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
