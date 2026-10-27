import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { JobsModule } from '../jobs/jobs.module';
import { StoreCreditModule } from '../store-credit/store-credit.module';
import {
  CustomerLoyaltyController,
  LoyaltyController,
} from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [AuditLogModule, JobsModule, StoreCreditModule],
  controllers: [LoyaltyController, CustomerLoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
