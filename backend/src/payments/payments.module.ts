import { Module } from '@nestjs/common';
import {
  PayController,
  PaymentLinkController,
  PaymentsWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { ShopModule } from '../shop/shop.module';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { TelrPaymentProvider } from './providers/telr-payment.provider';
import { PayTabsPaymentProvider } from './providers/paytabs-payment.provider';
import { TabbyPaymentProvider } from './providers/tabby-payment.provider';
import { TamaraPaymentProvider } from './providers/tamara-payment.provider';
import { NomodPaymentProvider } from './providers/nomod-payment.provider';
import { PayPalPaymentProvider } from './providers/paypal-payment.provider';
import { PaymentSettingsController } from './payment-settings.controller';
import { PaymentSettingsService } from './payment-settings.service';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { OrdersModule } from '../orders/orders.module';
import { WebhookLogModule } from '../webhook-log/webhook-log.module';

// Every implemented gateway is registered up front — which one a given shop
// actually uses is a per-shop runtime choice (shop.paymentGateway for the
// card-processor slot, shoppaymentprovider.enabled for the independent
// ones), resolved against this registry at call time by
// PaymentsService/PublicService, not a single app-wide env-selected
// instance like before merchant-facing gateway choice existed. Telr/PayTabs
// stay registered (existing, untouched) even though the new Payment
// Gateways settings page doesn't surface them — the task's provider list
// (Nomod/Stripe/PayPal/Tabby/Tamara/COD) replaces what's *offered in the
// UI*, not what's registered; nothing currently depends on de-registering them.
function paymentProviderRegistryFactory(): PaymentProviderRegistry {
  const registry = new PaymentProviderRegistry();
  registry.register(new StripePaymentProvider());
  registry.register(new TelrPaymentProvider());
  registry.register(new PayTabsPaymentProvider());
  registry.register(new TabbyPaymentProvider());
  registry.register(new TamaraPaymentProvider());
  registry.register(new NomodPaymentProvider());
  registry.register(new PayPalPaymentProvider());
  return registry;
}

@Module({
  imports: [ShopModule, AffiliateModule, BranchRolesModule, OrdersModule, WebhookLogModule],
  controllers: [
    PaymentLinkController,
    PayController,
    PaymentsWebhookController,
    PaymentSettingsController,
  ],
  providers: [
    PaymentsService,
    PaymentSettingsService,
    {
      provide: PaymentProviderRegistry,
      useFactory: paymentProviderRegistryFactory,
    },
  ],
  // PublicModule (storefront checkout) needs the same registry to create a
  // gateway checkout session directly from order creation, without going
  // through the merchant-generated payment-link flow. It also needs
  // PaymentSettingsService, to resolve per-shop credentials and check
  // whether the shop's active card processor is actually enabled.
  // PaymentsService itself is needed by DraftOrdersModule, which reuses
  // generateLink() verbatim for "send invoice" rather than building a
  // second payment-link mechanism.
  exports: [PaymentProviderRegistry, PaymentSettingsService, PaymentsService],
})
export class PaymentsModule {}
