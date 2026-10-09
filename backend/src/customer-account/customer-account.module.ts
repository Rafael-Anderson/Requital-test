import { Module } from '@nestjs/common';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PublicModule } from '../public/public.module';
import { RegionsModule } from '../regions/regions.module';
import { CustomerCrmModule } from '../customer-crm/customer-crm.module';

@Module({
  imports: [
    CustomerAuthModule,
    InvoicesModule,
    AuditLogModule,
    PublicModule,
    RegionsModule,
    CustomerCrmModule,
  ],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService],
})
export class CustomerAccountModule {}
