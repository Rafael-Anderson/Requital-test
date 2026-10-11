import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomerMergeController } from './customer-merge.controller';
import { CustomerMergeService } from './customer-merge.service';

@Module({
  imports: [AuditLogModule],
  controllers: [CustomerMergeController],
  providers: [CustomerMergeService],
})
export class CustomerMergeModule {}
