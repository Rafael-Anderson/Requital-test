import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { ProductsModule } from '../products/products.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [
    OrdersModule,
    PaymentsModule,
    AuditLogModule,
    GiftCardsModule,
    ProductsModule,
    BranchRolesModule,
  ],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
