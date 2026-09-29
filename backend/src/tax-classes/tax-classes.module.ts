import { Module } from '@nestjs/common';
import { TaxClassesController } from './tax-classes.controller';
import { TaxClassesService } from './tax-classes.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [TaxClassesController],
  providers: [TaxClassesService],
  // ProductsModule needs assertOwned() to reject a cross-shop taxClassId on
  // create/update, the same ownership check every outletId-taking write does.
  exports: [TaxClassesService],
})
export class TaxClassesModule {}
