import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({
  controllers: [ShopController],
  providers: [ShopService],
  // PaymentsModule reuses this for the COD toggle on the Payment Gateways
  // settings page — same shop.deliveryPaymentCashOnDelivery/
  // pickupPaymentCashOnPickup fields ShopService.update already validates
  // ("at least one payment method"), not a parallel write path around it.
  exports: [ShopService],
})
export class ShopModule {}
