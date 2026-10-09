import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomerSegmentsController } from './customer-segments.controller';
import { CustomerSegmentsService } from './customer-segments.service';

@Module({
  imports: [AuditLogModule],
  controllers: [CustomerSegmentsController],
  providers: [CustomerSegmentsService],
  exports: [CustomerSegmentsService],
})
export class CustomerSegmentsModule {}
