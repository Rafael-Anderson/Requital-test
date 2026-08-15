import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PublicController } from './public.controller';
import { PublicOrderLookupController } from './public-order-lookup.controller';
import { PublicSurveyController } from './public-survey.controller';
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
import { TemplatesModule } from '../templates/templates.module';
import { MenuModule } from '../menu/menu.module';
import { AbandonedCartsModule } from '../abandoned-carts/abandoned-carts.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { PolicyPagesModule } from '../policy-pages/policy-pages.module';
import { ThemesModule } from '../themes/themes.module';

@Module({
  imports: [
    // Same JWT secret as the staff AuthModule's JwtModule.register (one
    // secret, verified in multiple modules) — same convention
    // CustomerAuthModule already follows. Only used to verify (never sign)
    // a staff token passed as a query param for the theme builder's preview
    // bypass — see PublicService.isAuthorizedPreview.
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    PaymentsModule,
    CustomersModule,
    AffiliateModule,
    BioLinksModule,
    ProductsModule,
    DiscountsModule,
    OrderNotificationsModule,
    TemplatesModule,
    MenuModule,
    AbandonedCartsModule,
    GiftCardsModule,
    PolicyPagesModule,
    ThemesModule,
  ],
  controllers: [
    PublicController,
    PublicOrderLookupController,
    PublicSurveyController,
    PublicShopsController,
    PublicAbandonedCartRecoveryController,
  ],
  providers: [PublicService],
})
export class PublicModule {}
