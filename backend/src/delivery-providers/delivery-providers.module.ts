import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { OutletsModule } from '../outlets/outlets.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { ExternalDeliveriesModule } from '../external-deliveries/external-deliveries.module';
import { JobsModule } from '../jobs/jobs.module';
import { WebhookLogModule } from '../webhook-log/webhook-log.module';
import { SliderDeliveryProvider } from './slider/slider-delivery.provider';
import { SliderSettingsService } from './slider-settings.service';
import { SliderSettingsController } from './slider-settings.controller';
import { SliderDeliveryService } from './slider-delivery.service';
import { SliderDeliveryController } from './slider-delivery.controller';
import { SliderWebhookController } from './slider-webhook.controller';
import { SliderWebhookJobHandler } from './slider-webhook.handler';

// Platform-level Slider credentials (SLIDER_API_KEY/SLIDER_ENVIRONMENT/
// SLIDER_WEBHOOK_TOKEN) live in env vars, resolved directly by
// SliderSettingsService/SliderWebhookJobHandler — not passed through this
// module in any way. Sandbox-only in practice today: nothing currently sets
// SLIDER_ENVIRONMENT=production anywhere real. No provider registry (unlike
// PaymentProviderRegistry) — one courier integration exists, see
// slider-delivery.interface.ts's own note.
@Module({
  imports: [
    OrdersModule,
    OutletsModule,
    BranchRolesModule,
    ExternalDeliveriesModule,
    JobsModule,
    WebhookLogModule,
  ],
  controllers: [
    SliderSettingsController,
    SliderDeliveryController,
    SliderWebhookController,
  ],
  providers: [
    SliderDeliveryProvider,
    SliderSettingsService,
    SliderDeliveryService,
    SliderWebhookJobHandler,
  ],
  // SliderSettingsService and SliderDeliveryProvider are needed by
  // PlatformAdminModule (setting a shop's sliderAccountId, and the "Test
  // dispatch" action's direct getQuote call) — everything else here stays
  // private to this module.
  exports: [SliderSettingsService, SliderDeliveryProvider],
})
export class DeliveryProvidersModule {}
