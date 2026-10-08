import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { DeliveryProvidersModule } from '../delivery-providers/delivery-providers.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { WebhookLogModule } from '../webhook-log/webhook-log.module';
import { JobsModule } from '../jobs/jobs.module';
import { CurrencyRatesModule } from '../currency-rates/currency-rates.module';

@Module({
  imports: [
    DeliveryProvidersModule,
    AuthModule,
    PlatformAuthModule,
    WebhookLogModule,
    CurrencyRatesModule,
    JobsModule,
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAuditLogService],
})
export class PlatformAdminModule {}
