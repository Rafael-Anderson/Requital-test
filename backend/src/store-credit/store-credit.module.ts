import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StoreCreditController } from './store-credit.controller';
import { StoreCreditService } from './store-credit.service';

@Module({
  imports: [AuditLogModule],
  controllers: [StoreCreditController],
  providers: [StoreCreditService],
  exports: [StoreCreditService],
})
export class StoreCreditModule {}
