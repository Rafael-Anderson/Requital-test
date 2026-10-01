import { Module } from '@nestjs/common';
import {
  DiscountValidationController,
  DraftOrdersController,
} from './draft-orders.controller';
import { DraftOrdersService } from './draft-orders.service';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { RegionsModule } from '../regions/regions.module';

@Module({
  imports: [
    ProductsModule,
    DiscountsModule,
    OrdersModule,
    PaymentsModule,
    RegionsModule,
  ],
  controllers: [DraftOrdersController, DiscountValidationController],
  providers: [DraftOrdersService],
})
export class DraftOrdersModule {}
