import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider } from './payment-provider.interface';

// Replaces the old single-PAYMENT_PROVIDER-env-var setup — a shop now picks
// its own gateway (shop.paymentGateway), so the app needs every implemented
// provider available at once, resolved by name at call time, rather than
// one instance chosen globally at boot.
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new NotFoundException(
        `Unknown or unconfigured payment gateway '${name}'`,
      );
    }
    return provider;
  }
}
