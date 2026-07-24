import { Module } from '@nestjs/common';
import {
  PayController,
  PaymentLinkController,
  PaymentsWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { StripePaymentProvider } from './providers/stripe-payment.provider';

// Which gateway backs PAYMENT_PROVIDER is a config choice, not a code change —
// add a case here (and a providers/<gateway>-payment.provider.ts) for
// Telr/PayTabs/Tabby/Tamara without touching PaymentsService.
function paymentProviderFactory() {
  const gateway = process.env.PAYMENT_PROVIDER ?? 'stripe';
  switch (gateway) {
    case 'stripe':
      return new StripePaymentProvider();
    default:
      throw new Error(`Unsupported PAYMENT_PROVIDER: ${gateway}`);
  }
}

@Module({
  controllers: [
    PaymentLinkController,
    PayController,
    PaymentsWebhookController,
  ],
  providers: [
    PaymentsService,
    { provide: PAYMENT_PROVIDER, useFactory: paymentProviderFactory },
  ],
})
export class PaymentsModule {}
