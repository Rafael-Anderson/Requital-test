import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SendingDomainsController } from './sending-domains.controller';
import { SendingDomainsService } from './sending-domains.service';
import {
  NotConfiguredSendingDomainsClient,
  ResendDomainsClient,
  SENDING_DOMAINS_CLIENT,
} from './sending-domains.client';

@Module({
  imports: [JobsModule, AuditLogModule],
  controllers: [SendingDomainsController],
  providers: [
    SendingDomainsService,
    {
      provide: SENDING_DOMAINS_CLIENT,
      // Read once at boot; the key is never logged. Unset = visibly unavailable.
      useFactory: () => {
        const key = process.env.RESEND_DOMAINS_API_KEY;
        return key && key !== 'test'
          ? new ResendDomainsClient(key)
          : new NotConfiguredSendingDomainsClient();
      },
    },
  ],
  exports: [SendingDomainsService],
})
export class SendingDomainsModule {}
