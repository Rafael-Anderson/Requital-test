import { Module } from '@nestjs/common';
import { DeliveryZonesController } from './delivery-zones.controller';
import { DeliveryZonesService } from './delivery-zones.service';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [BranchRolesModule],
  controllers: [DeliveryZonesController],
  providers: [DeliveryZonesService],
})
export class DeliveryZonesModule {}
