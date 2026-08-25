import { BadRequestException } from '@nestjs/common';

// Mirrors PaymentProviderNotConfiguredException — same "the caller resolved
// no usable credentials" shape, own type so callers can tell it apart from a
// generic 400.
export class DeliveryProviderNotConfiguredException extends BadRequestException {
  constructor(providerName: string) {
    super(`${providerName} is not configured for this shop`);
  }
}
