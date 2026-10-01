import { Module } from '@nestjs/common';
import {
  MetafieldDefinitionsController,
  MetafieldValuesController,
} from './metafields.controller';
import { MetafieldsService } from './metafields.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';

@Module({
  imports: [AuditLogModule, BranchRolesModule],
  controllers: [MetafieldDefinitionsController, MetafieldValuesController],
  providers: [MetafieldsService],
  exports: [MetafieldsService],
})
export class MetafieldsModule {}
