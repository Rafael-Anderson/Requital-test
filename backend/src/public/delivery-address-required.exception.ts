import { BadRequestException } from '@nestjs/common';

// A plain 400 to createOrder; a distinct type only so the delivery-fee quote can
// answer "needs_address" (rather than "unavailable") for the same rejection.
export class DeliveryAddressRequiredException extends BadRequestException {}
