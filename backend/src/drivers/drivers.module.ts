import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { OrdersModule } from '../orders/orders.module';
import { JobsModule } from '../jobs/jobs.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DeliveryRunsController } from './delivery-runs.controller';
import { DeliveryRunsService } from './delivery-runs.service';
import { DriverLinksService } from './driver-links.service';
import { DriverAppController } from './driver-app.controller';
import { DriverAppService } from './driver-app.service';

// SHP-5: dispatch to a merchant's own drivers. See docs/handoff/t2.md.
@Module({
  imports: [AuditLogModule, BranchRolesModule, OrdersModule, JobsModule],
  controllers: [DriversController, DeliveryRunsController, DriverAppController],
  providers: [
    DriversService,
    DeliveryRunsService,
    DriverLinksService,
    DriverAppService,
  ],
})
export class DriversModule {}
