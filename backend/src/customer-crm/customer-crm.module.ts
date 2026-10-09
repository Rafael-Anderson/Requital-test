import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  CustomerCrmController,
  CustomerTagsController,
} from './customer-crm.controller';
import { CustomerTagsService } from './customer-tags.service';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerConsentService } from './customer-consent.service';

// CUS-2 tags, CUS-3 notes, CUS-11 consent. The services are exported for the
// customer list (tags per row), the storefront account page (consent) and the
// merge (CustomerMergeModule).
@Module({
  imports: [AuditLogModule],
  controllers: [CustomerTagsController, CustomerCrmController],
  providers: [CustomerTagsService, CustomerNotesService, CustomerConsentService],
  exports: [CustomerTagsService, CustomerNotesService, CustomerConsentService],
})
export class CustomerCrmModule {}
