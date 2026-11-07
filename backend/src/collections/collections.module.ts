import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { CollectionRulesService } from './collection-rules.service';
import { CollectionImportService } from './collection-import.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditLogModule, StorageModule],
  controllers: [CollectionsController],
  providers: [CollectionsService, CollectionImportService, CollectionRulesService],
  exports: [CollectionRulesService],
})
export class CollectionsModule {}
