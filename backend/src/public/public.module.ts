import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicOrderLookupController } from './public-order-lookup.controller';
import { PublicShopsController } from './public-shops.controller';
import { PublicAbandonedCartRecoveryController } from './public-abandoned-cart-recovery.controller';
import { PublicService } from './public.service';
import { PaymentsModule } from '../payments/payments.module';
import { CustomersModule } from '../customers/customers.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { BioLinksModule } from '../bio-links/bio-links.module';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { OrderNotificationsModule } from '../orders/order-notifications.module';
import { CollectionsModule } from '../collections/collections.module';
import { AbandonedCartsModule } from '../abandoned-carts/abandoned-carts.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { PolicyPagesModule } from '../policy-pages/policy-pages.module';

@Module({
  imports: [
    PaymentsModule,
    CustomersModule,
    AffiliateModule,
    BioLinksModule,
    ProductsModule,
    DiscountsModule,
    OrderNotificationsModule,
    CollectionsModule,
    AbandonedCartsModule,
    GiftCardsModule,
    PolicyPagesModule,
  ],
  controllers: [
    PublicController,
    PublicOrderLookupController,
    PublicShopsController,
    PublicAbandonedCartRecoveryController,
  ],
  providers: [PublicService],
})
export class PublicModule {}
