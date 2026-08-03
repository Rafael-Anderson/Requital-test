import { Module } from '@nestjs/common';
import { BranchRolesService } from './branch-roles.service';
import { BranchRolesController } from './branch-roles.controller';

@Module({
  controllers: [BranchRolesController],
  providers: [BranchRolesService],
  exports: [BranchRolesService],
})
export class BranchRolesModule {}
