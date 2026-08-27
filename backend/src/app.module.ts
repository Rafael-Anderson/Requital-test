import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { RequestContextMiddleware } from './common/logging/request-context.middleware';
import { platformCsrf } from './platform-auth/platform-auth.constants';
import { staffCsrf } from './auth/auth.constants';
import { customerCsrf } from './customer-auth/customer-auth.constants';
import { AllExceptionsFilter } from './common/error-tracking/all-exceptions.filter';
import { resolveErrorTrackingProvider } from './common/error-tracking/error-tracking.provider';
import { HealthModule } from './health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { OutletsModule } from './outlets/outlets.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PaymentsModule } from './payments/payments.module';
import { CollectionsModule } from './collections/collections.module';
import { ShopModule } from './shop/shop.module';
import { DeliveryZonesModule } from './delivery-zones/delivery-zones.module';
import { PublicModule } from './public/public.module';
import { CustomersModule } from './customers/customers.module';
import { ReportsModule } from './reports/reports.module';
import { ExternalDeliveriesModule } from './external-deliveries/external-deliveries.module';
import { ThemeModule } from './theme/theme.module';
import { ThemesModule } from './themes/themes.module';
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
import { TemplatesModule } from './templates/templates.module';
import { MenuModule } from './menu/menu.module';
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
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './storage/storage.module';
import { DomainsModule } from './domains/domains.module';
import { DeliveryProvidersModule } from './delivery-providers/delivery-providers.module';
import { WebhookLogModule } from './webhook-log/webhook-log.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';

@Module({
  imports: [
    // Powers @Cron() in LowStockDigestService and AbandonedCartsService —
    // one registration for the whole app, same as every other *Module.forRoot()
    // singleton (DatabaseModule, etc.).
    ScheduleModule.forRoot(),
    // Global per-IP default — generous enough not to affect normal admin/
    // storefront polling (orders list polls every 20s, per admin/AGENTS.md).
    // Individual auth/checkout endpoints override this with a much tighter
    // limit via @Throttle(...) — see auth.controller.ts, customer-auth.
    // controller.ts, and public.controller.ts.
    //
    // skipIf disables enforcement under Jest (NODE_ENV=test, set
    // automatically by Jest itself — confirmed, not assumed) rather than in
    // production: dozens of existing e2e specs legitimately call
    // /auth/signup or /auth/login many times in quick succession from the
    // same in-process supertest client, which the 5/min auth limits below
    // would otherwise reject with 429s that have nothing to do with the
    // behavior those tests are actually checking.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    DatabaseModule,
    AuthModule,
    OutletsModule,
    ProductsModule,
    OrdersModule,
    DashboardModule,
    PaymentsModule,
    CollectionsModule,
    ShopModule,
    DeliveryZonesModule,
    PublicModule,
    CustomersModule,
    ReportsModule,
    ExternalDeliveriesModule,
    ThemeModule,
    ThemesModule,
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
    TemplatesModule,
    MenuModule,
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
    HealthModule,
    JobsModule,
    StorageModule,
    DomainsModule,
    DeliveryProvidersModule,
    WebhookLogModule,
    PlatformAuthModule,
    PlatformAdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // APP_FILTER, not app.useGlobalFilters() in main.ts — same reason
    // AuthGuard/RolesGuard are APP_GUARD providers instead: main.ts's
    // bootstrap() never runs under Jest, so a filter only wired there would
    // be inactive (and untested) in every e2e spec.
    {
      provide: APP_FILTER,
      useFactory: () => new AllExceptionsFilter(resolveErrorTrackingProvider()),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    // Registered here, not via app.use(cookieParser()) in main.ts, for the
    // same reason RequestContextMiddleware/AllExceptionsFilter are wired
    // this way: main.ts's bootstrap() never runs under Jest (see CLAUDE.md),
    // so a middleware only mounted there would leave req.cookies undefined
    // in every e2e spec — which is exactly what happened here the first
    // time (every cookie-authenticated request 404'd/500'd under Jest until
    // this moved). Must run before the CSRF middleware below, which reads
    // req.cookies itself.
    consumer.apply(cookieParser()).forRoutes('*');
    // Session-cookie migration (security audit finding #1) — platform admin
    // is the first tier moved; staff/customer join this same wiring as
    // their own phases land, each with their own TierCsrf instance (see
    // common/csrf.ts). login is excluded: it's the request that creates the
    // very session the CSRF cookie would otherwise be checked against, so
    // there's nothing valid to check yet, and nothing an attacker gains by
    // forging a login attempt with credentials they don't have.
    consumer
      .apply(platformCsrf.doubleCsrfProtection)
      .exclude({ path: 'platform-auth/login', method: RequestMethod.POST })
      .forRoutes('platform-auth', 'platform-admin');
    // Phase 2/3 — staff and customer sit behind their own session cookie on
    // essentially every controller in the app (not a closed prefix like
    // platform admin above), so both are applied globally rather than
    // scoped with forRoutes/exclude. Each middleware is a no-op unless this
    // tier's own access cookie is actually present on the request — see
    // createTierCsrf's skipIfNoAccessCookie comment for why that's still a
    // real, uncompromised guarantee. No explicit login/signup exclusion is
    // needed here either, for the same reason: neither cookie exists yet on
    // a pre-login request, so the skip already covers it.
    consumer.apply(staffCsrf.doubleCsrfProtection).forRoutes('*');
    consumer.apply(customerCsrf.doubleCsrfProtection).forRoutes('*');
  }
}
