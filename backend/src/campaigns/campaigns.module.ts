import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomerCrmModule } from '../customer-crm/customer-crm.module';
import { JobsModule } from '../jobs/jobs.module';
import { SendingDomainsModule } from '../sending-domains/sending-domains.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignSenderService } from './campaign-sender.service';
import { CampaignUnsubscribeService } from './campaign-unsubscribe.service';
import { PublicCampaignUnsubscribeController } from './public-campaign-unsubscribe.controller';

// MKT-1 consent-gated email campaigns (behind the email_campaigns feature key).
@Module({
  imports: [
    AuditLogModule,
    CustomerCrmModule,
    JobsModule,
    SendingDomainsModule,
  ],
  controllers: [CampaignsController, PublicCampaignUnsubscribeController],
  providers: [
    CampaignsService,
    CampaignSenderService,
    CampaignUnsubscribeService,
  ],
})
export class CampaignsModule {}
