import { Module } from '@nestjs/common';
import { ExternalDeliveriesController } from './external-deliveries.controller';
import { ExternalDeliveriesService } from './external-deliveries.service';

@Module({
  controllers: [ExternalDeliveriesController],
  providers: [ExternalDeliveriesService],
})
export class ExternalDeliveriesModule {}
