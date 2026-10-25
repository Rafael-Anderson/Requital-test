import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

// FeaturesModule and DatabaseModule are @Global. Deliberately NOT imported by
// PublicModule, OrdersModule or DraftOrdersModule: order creation never touches
// billing (the soft ceiling never blocks anything).
@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
