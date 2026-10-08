import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { OrdersModule } from '../orders/orders.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DeliveryRunsController } from './delivery-runs.controller';
import { DeliveryRunsService } from './delivery-runs.service';

// SHP-5: dispatch to a merchant's own drivers. See docs/handoff/t2.md.
@Module({
  imports: [AuditLogModule, BranchRolesModule, OrdersModule],
  controllers: [DriversController, DeliveryRunsController],
  providers: [DriversService, DeliveryRunsService],
})
export class DriversModule {}
