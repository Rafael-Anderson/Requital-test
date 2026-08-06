import { Module } from '@nestjs/common';
import { AbandonedCartsController } from './abandoned-carts.controller';
import { AbandonedCartsService } from './abandoned-carts.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [AbandonedCartsController],
  providers: [AbandonedCartsService],
  // Consumed by PublicModule for the storefront capture/recover endpoints
  // and by PublicService for the createOrder-time markRecovered call.
  exports: [AbandonedCartsService],
})
export class AbandonedCartsModule {}
