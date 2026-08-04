import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OutletsModule } from './outlets/outlets.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PaymentsModule } from './payments/payments.module';
import { CategoriesModule } from './categories/categories.module';
import { ShopModule } from './shop/shop.module';
import { DeliveryZonesModule } from './delivery-zones/delivery-zones.module';
import { PublicModule } from './public/public.module';
import { CustomersModule } from './customers/customers.module';
import { ReportsModule } from './reports/reports.module';
import { ExternalDeliveriesModule } from './external-deliveries/external-deliveries.module';
import { ThemeModule } from './theme/theme.module';
import { SeoModule } from './seo/seo.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { BioLinksModule } from './bio-links/bio-links.module';
import { DiscountsModule } from './discounts/discounts.module';
import { DraftOrdersModule } from './draft-orders/draft-orders.module';
import { SearchModule } from './search/search.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { IngredientsModule } from './ingredients/ingredients.module';
import { IngredientCategoriesModule } from './ingredient-categories/ingredient-categories.module';
import { CollectionsModule } from './collections/collections.module';
import { ReturnsModule } from './returns/returns.module';
import { ScanModule } from './scan/scan.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { CustomerAccountModule } from './customer-account/customer-account.module';
import { AbandonedCartsModule } from './abandoned-carts/abandoned-carts.module';
import { GiftCardsModule } from './gift-cards/gift-cards.module';
import { PolicyPagesModule } from './policy-pages/policy-pages.module';
import { BranchRolesModule } from './branch-roles/branch-roles.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NotifySubscriptionsModule } from './notify-subscriptions/notify-subscriptions.module';
import { StorefrontSearchModule } from './storefront-search/storefront-search.module';

@Module({
  imports: [
    // Powers @Cron() in LowStockDigestService and AbandonedCartsService —
    // one registration for the whole app, same as every other *Module.forRoot()
    // singleton (PrismaModule, etc.).
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    OutletsModule,
    ProductsModule,
    OrdersModule,
    DashboardModule,
    PaymentsModule,
    CategoriesModule,
    ShopModule,
    DeliveryZonesModule,
    PublicModule,
    CustomersModule,
    ReportsModule,
    ExternalDeliveriesModule,
    ThemeModule,
    SeoModule,
    AffiliateModule,
    BioLinksModule,
    DiscountsModule,
    DraftOrdersModule,
    SearchModule,
    AuditLogModule,
    WhatsAppModule,
    IngredientsModule,
    IngredientCategoriesModule,
    BranchRolesModule,
    CollectionsModule,
    ReturnsModule,
    ScanModule,
    CustomerAuthModule,
    CustomerAccountModule,
    AbandonedCartsModule,
    GiftCardsModule,
    PolicyPagesModule,
    InvoicesModule,
    NotifySubscriptionsModule,
    StorefrontSearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
