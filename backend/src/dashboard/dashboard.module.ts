import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [BranchRolesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
