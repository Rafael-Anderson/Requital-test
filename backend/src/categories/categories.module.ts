import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditLogModule, StorageModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
