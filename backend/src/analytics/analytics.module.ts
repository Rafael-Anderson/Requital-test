import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AnalyticsRollupService } from './analytics-rollup.service';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { SalesSummaryService } from './sales-summary.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [JobsModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsRollupService,
    InventoryAnalyticsService,
    SalesSummaryService,
  ],
  exports: [
    AnalyticsRollupService,
    InventoryAnalyticsService,
    SalesSummaryService,
  ],
})
export class AnalyticsModule {}
