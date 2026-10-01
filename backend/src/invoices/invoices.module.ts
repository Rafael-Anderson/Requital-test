import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { OrdersModule } from '../orders/orders.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [OrdersModule, BranchRolesModule, AuditLogModule],
  controllers: [InvoicesController, CreditNotesController],
  providers: [InvoicesService, CreditNotesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
