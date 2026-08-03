import { Module } from '@nestjs/common';
import { OutletsController } from './outlets.controller';
import { OutletsService } from './outlets.service';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [BranchRolesModule],
  controllers: [OutletsController],
  providers: [OutletsService],
  exports: [OutletsService],
})
export class OutletsModule {}
