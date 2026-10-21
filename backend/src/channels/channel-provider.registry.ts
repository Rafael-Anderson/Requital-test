import { Injectable } from '@nestjs/common';
import type { ChannelProvider } from './channel.types';

// Same shape as PaymentProviderRegistry: the app needs every implemented
// provider available at once, resolved by name from the connection row.
// E2 registers Deliveroo and E3 Talabat from their own modules; nothing here
// knows either of them.
@Injectable()
export class ChannelProviderRegistry {
  private readonly providers = new Map<string, ChannelProvider>();

  register(provider: ChannelProvider): void {
    this.providers.set(provider.name, provider);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  // undefined (not a throw): a connection whose provider is no longer
  // registered must degrade to "cannot process", never crash a sweep.
  find(name: string): ChannelProvider | undefined {
    return this.providers.get(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}
