import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';
import { ValidateDiscountDto } from '../discounts/dto/validate-discount.dto';
import { CaptureAbandonedCartDto } from '../abandoned-carts/dto/capture-abandoned-cart.dto';
import { ValidateGiftCardDto } from '../gift-cards/dto/validate-gift-card.dto';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';

// Unauthenticated, shop-scoped by a path-prefixed slug (shop.subdomain) —
// the storefront app resolves which shop it's serving from its own URL
// (storefront.example.com/<shopSlug>/...) and passes that slug straight
// through as the first path segment on every call here. No bearer token, no
// TenantContext — every method re-resolves the shop from shopSlug itself.
@Controller('public/:shopSlug')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get()
  getShop(@Param('shopSlug') shopSlug: string) {
    return this.publicService.getShop(shopSlug);
  }

  @Public()
  @Get('collections')
  listCollections(
    @Param('shopSlug') shopSlug: string,
    @Query('previewToken') previewToken?: string,
  ) {
    return this.publicService.listCollections(shopSlug, previewToken);
  }

  // Collection (taxonomy node) detail page, /[shop]/collections/[slug] —
  // replaces the pre-Phase-C curated-list detail that used to live at this
  // same URL (now served by GET templates/:slug instead).
  @Public()
  @Get('collections/:slug')
  getCollectionBySlug(
    @Param('shopSlug') shopSlug: string,
    @Param('slug') slug: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getCollectionBySlug(
      shopSlug,
      slug,
      outletId ? Number(outletId) : undefined,
    );
  }

  // Storefront Home tab, 'templates' mode.
  @Public()
  @Get('homepage-templates')
  getHomepageTemplates(
    @Param('shopSlug') shopSlug: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getHomepageTemplates(
      shopSlug,
      outletId ? Number(outletId) : undefined,
    );
  }

  // Storefront top-bar "Menu" — direct Collection links + Dropdowns.
  @Public()
  @Get('menu')
  getMenu(
    @Param('shopSlug') shopSlug: string,
    @Query('previewToken') previewToken?: string,
  ) {
    return this.publicService.getMenu(shopSlug, previewToken);
  }

  // New visual theme builder's storefront-facing config read. preview=true
  // requires themeId and returns that theme's live draft (never cached);
  // otherwise returns the shop's published theme's config (cached, 60s TTL)
  // or null if the shop has no published new-system theme yet.
  @Public()
  @Get('theme-config')
  getThemeConfig(
    @Param('shopSlug') shopSlug: string,
    @Query('preview') preview?: string,
    @Query('themeId') themeId?: string,
  ) {
    return this.publicService.getThemeConfig(shopSlug, {
      preview: preview === 'true',
      themeId: themeId ? Number(themeId) : undefined,
    });
  }

  @Public()
  @Get('bio-links')
  listBioLinks(@Param('shopSlug') shopSlug: string) {
    return this.publicService.listBioLinks(shopSlug);
  }

  @Public()
  @Get('bio-page-config')
  getBioPageConfig(@Param('shopSlug') shopSlug: string) {
    return this.publicService.getBioPageConfig(shopSlug);
  }

  @Public()
  @Get('templates')
  listTemplates(@Param('shopSlug') shopSlug: string) {
    return this.publicService.listTemplates(shopSlug);
  }

  @Public()
  @Get('templates/:slug')
  getTemplate(
    @Param('shopSlug') shopSlug: string,
    @Param('slug') slug: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getTemplate(
      shopSlug,
      slug,
      outletId ? Number(outletId) : undefined,
    );
  }

  @Public()
  @Get('products')
  listProducts(
    @Param('shopSlug') shopSlug: string,
    @Query('outletId') outletId?: string,
    @Query('collectionId') collectionId?: string,
    @Query('isCheckoutAddon') isCheckoutAddon?: string,
    @Query('previewToken') previewToken?: string,
  ) {
    return this.publicService.listProducts(
      shopSlug,
      outletId ? Number(outletId) : undefined,
      collectionId ? Number(collectionId) : undefined,
      isCheckoutAddon !== undefined ? isCheckoutAddon === 'true' : undefined,
      previewToken,
    );
  }

  @Public()
  @Get('outlets')
  listOutlets(
    @Param('shopSlug') shopSlug: string,
    @Query('previewToken') previewToken?: string,
  ) {
    return this.publicService.listOutlets(shopSlug, previewToken);
  }

  // Registered before 'products/:id' resolution order doesn't matter here
  // since the prefix differs ('outlets' vs 'products'), but kept before the
  // generic products/:id route in file order for readability.
  @Public()
  @Get('outlets/:outletId/delivery-zones')
  listDeliveryZones(
    @Param('shopSlug') shopSlug: string,
    @Param('outletId', ParseIntPipe) outletId: number,
  ) {
    return this.publicService.listDeliveryZones(shopSlug, outletId);
  }

  // Registered before 'products/:id' so a slug segment never gets swallowed
  // by :id's ParseIntPipe (it would just 400 on a non-numeric slug, but this
  // keeps intent obvious).
  @Public()
  @Get('products/slug/:slug')
  getProductBySlug(
    @Param('shopSlug') shopSlug: string,
    @Param('slug') slug: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getProductBySlug(
      shopSlug,
      slug,
      outletId ? Number(outletId) : undefined,
    );
  }

  // Same slug-before-:id ordering reasoning as getProductBySlug above — 3
  // segments here so it can never collide with either.
  @Public()
  @Get('products/slug/:slug/related')
  getRelatedProducts(
    @Param('shopSlug') shopSlug: string,
    @Param('slug') slug: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getRelatedProducts(
      shopSlug,
      slug,
      outletId ? Number(outletId) : undefined,
    );
  }

  // Kept working (not replaced) so links shared before slug routing existed
  // don't break — the storefront's id-based route now just resolves the
  // product here to find its slug and redirects, but the API itself stays.
  @Public()
  @Get('products/:id')
  getProduct(
    @Param('shopSlug') shopSlug: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('outletId') outletId?: string,
  ) {
    return this.publicService.getProduct(
      shopSlug,
      id,
      outletId ? Number(outletId) : undefined,
    );
  }

  @Public()
  @Get('geocode')
  geocode(@Query('q') query?: string) {
    return this.publicService.geocode(query);
  }

  @Public()
  @Get('reverse-geocode')
  reverseGeocode(@Query('lat') lat?: string, @Query('lon') lon?: string) {
    return this.publicService.reverseGeocode(
      lat !== undefined ? Number(lat) : undefined,
      lon !== undefined ? Number(lon) : undefined,
    );
  }

  @Public()
  @Get('policy-pages/:type')
  getPolicyPage(
    @Param('shopSlug') shopSlug: string,
    @Param('type') type: string,
  ) {
    return this.publicService.getPolicyPage(shopSlug, type);
  }

  // Guest-facing live validation as the shopper types a code into cart/
  // checkout — mirrors the admin-authenticated POST /shop/discounts/validate
  // (DiscountsController), just resolved via shopSlug instead of an
  // authenticated ctx.shopId. The actual order-creation call below
  // re-validates and atomically claims the code itself either way — this
  // endpoint never touches usage counters.
  // Enumeration-sensitive (guessing a valid code) — tighter than the
  // global default, but loose enough for a shopper retyping a code a few
  // times.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('discounts/validate')
  validateDiscount(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: ValidateDiscountDto,
  ) {
    return this.publicService.validateDiscount(shopSlug, dto);
  }

  // No account/password exists on this path to lock out, but unthrottled
  // order creation is still a real abuse surface (scripted fake-order spam,
  // stock/discount-claim exhaustion) — 20/min/IP is generous for a genuine
  // shopper retrying a failed payment or COD submission.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('orders')
  createOrder(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: CreatePublicOrderDto,
  ) {
    return this.publicService.createOrder(shopSlug, dto);
  }

  // Fired by the checkout page once name+phone are both filled in — see
  // AbandonedCartsService.capture for the upsert/reset semantics. Never
  // blocks or errors the checkout flow itself from the caller's
  // perspective; the storefront fires this and ignores the response.
  // Higher limit than its siblings — legitimately re-fires as address/
  // outlet fields change while the customer is still filling out checkout.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Public()
  @Post('abandoned-carts')
  captureAbandonedCart(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: CaptureAbandonedCartDto,
  ) {
    return this.publicService.captureAbandonedCart(shopSlug, dto);
  }

  // Guest-facing live validation as the shopper types a gift card code at
  // checkout — mirrors discounts/validate above exactly. Order creation
  // re-validates and atomically claims the balance itself either way.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('gift-cards/validate')
  validateGiftCard(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: ValidateGiftCardDto,
  ) {
    return this.publicService.validateGiftCard(shopSlug, dto);
  }

  // Newsletter section's signup form (storefront/components/theme-sections/
  // NewsletterSection.tsx) — same rate-limit shape as this file's other
  // unauthenticated write endpoints.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('newsletter-subscribe')
  subscribeNewsletter(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: SubscribeNewsletterDto,
  ) {
    return this.publicService.subscribeNewsletter(shopSlug, dto);
  }
}
