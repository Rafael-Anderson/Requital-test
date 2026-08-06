import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditLogModule, StorageModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
