import { Module } from '@nestjs/common';
import { NotifySubscriptionsController } from './notify-subscriptions.controller';
import { NotifySubscriptionsService } from './notify-subscriptions.service';

@Module({
  controllers: [NotifySubscriptionsController],
  providers: [NotifySubscriptionsService],
  // Consumed by ProductsModule/OrdersModule to fire triggerForProduct
  // wherever stock is written back up past zero.
  exports: [NotifySubscriptionsService],
})
export class NotifySubscriptionsModule {}
