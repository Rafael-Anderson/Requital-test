import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AnalyticsRollupService } from './analytics-rollup.service';

@Module({
  imports: [JobsModule],
  providers: [AnalyticsRollupService],
  exports: [AnalyticsRollupService],
})
export class AnalyticsModule {}
