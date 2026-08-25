import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { OutletsModule } from '../outlets/outlets.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { ExternalDeliveriesModule } from '../external-deliveries/external-deliveries.module';
import { JobsModule } from '../jobs/jobs.module';
import { SliderDeliveryProvider } from './slider/slider-delivery.provider';
import { SliderSettingsService } from './slider-settings.service';
import { SliderSettingsController } from './slider-settings.controller';
import { SliderDeliveryService } from './slider-delivery.service';
import { SliderDeliveryController } from './slider-delivery.controller';
import { SliderWebhookController } from './slider-webhook.controller';
import { SliderWebhookJobHandler } from './slider-webhook.handler';

// Sandbox-only for this PR (see slider/slider.constants.ts's SLIDER_BASE_URLS —
// 'production' is defined but nothing lets a shop actually select it yet;
// SetSliderCredentialsDto's @IsIn accepts both keys of that same const, so
// wiring production up later is a settings-page change, not a backend one).
// No provider registry (unlike PaymentProviderRegistry) — one courier
// integration exists, see slider-delivery.interface.ts's own note.
@Module({
  imports: [
    OrdersModule,
    OutletsModule,
    BranchRolesModule,
    ExternalDeliveriesModule,
    JobsModule,
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
})
export class DeliveryProvidersModule {}
