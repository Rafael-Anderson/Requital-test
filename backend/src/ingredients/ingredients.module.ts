import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [AuditLogModule, BranchRolesModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
