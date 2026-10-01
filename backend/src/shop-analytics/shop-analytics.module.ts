import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ShopAnalyticsController } from './shop-analytics.controller';
import { ShopAnalyticsService } from './shop-analytics.service';
import { ConversionEventsService } from './conversion-events.service';
import { MetaCapiClient } from './meta-capi.client';

@Module({
  imports: [JobsModule, AuditLogModule],
  controllers: [ShopAnalyticsController],
  providers: [ShopAnalyticsService, ConversionEventsService, MetaCapiClient],
  exports: [ShopAnalyticsService, ConversionEventsService, MetaCapiClient],
})
export class ShopAnalyticsModule {}
