import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { DeliveryProvidersModule } from '../delivery-providers/delivery-providers.module';

@Module({
  imports: [DeliveryProvidersModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
