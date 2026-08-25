import { Module } from '@nestjs/common';
import { ExternalDeliveriesController } from './external-deliveries.controller';
import { ExternalDeliveriesService } from './external-deliveries.service';

@Module({
  controllers: [ExternalDeliveriesController],
  providers: [ExternalDeliveriesService],
  // Needed by DeliveryProvidersModule's SliderDeliveryService/
  // SliderWebhookJobHandler — same table, same "one delivery record per
  // order" ownership, just a different creator (Slider dispatch vs. manual
  // logging).
  exports: [ExternalDeliveriesService],
})
export class ExternalDeliveriesModule {}
