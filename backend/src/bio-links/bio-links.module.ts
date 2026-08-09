import { Module } from '@nestjs/common';
import { BioLinksController } from './bio-links.controller';
import { PublicBioLinksController } from './public-bio-links.controller';
import { BioLinksService } from './bio-links.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuditLogModule, StorageModule],
  controllers: [BioLinksController, PublicBioLinksController],
  providers: [BioLinksService],
  // PublicModule needs this too — the shop-scoped public list route lives on
  // PublicController (mirrors collections/products/outlets exactly), which
  // delegates the actual resolution to this service after its own
  // resolveShop/assertPublished checks.
  exports: [BioLinksService],
})
export class BioLinksModule {}
