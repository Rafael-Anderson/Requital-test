import { Module } from '@nestjs/common';
import { DeliveryZonesController } from './delivery-zones.controller';
import { DeliveryZonesService } from './delivery-zones.service';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { RegionsModule } from '../regions/regions.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [BranchRolesModule, RegionsModule, AuditLogModule],
  controllers: [DeliveryZonesController],
  providers: [DeliveryZonesService],
})
export class DeliveryZonesModule {}
