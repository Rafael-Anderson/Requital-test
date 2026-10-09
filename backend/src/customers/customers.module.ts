import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerImportService } from './customer-import.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomerCrmModule } from '../customer-crm/customer-crm.module';

@Module({
  imports: [AuditLogModule, CustomerCrmModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerImportService],
  // OrdersModule (admin-entered orders) and PublicModule (storefront
  // checkout) both need findOrCreateForOrder — the one shared place phone-
  // matching logic lives.
  exports: [CustomersService],
})
export class CustomersModule {}
