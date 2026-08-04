import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateShopDto {
  // Gates storefront visibility — see PublicService.assertPublished and the
  // admin "Publish your store" action (Settings > Business Information). A
  // plain boolean, not a one-way "publish" endpoint: a merchant can also
  // unpublish (e.g. going on hiatus) through the same field.
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @IsOptional()
  @IsIn(['brand', 'legal'])
  trademarkFormat?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  whatsappCountryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsappNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  notifyWhatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyCustomersWhatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  // Abandoned Cart Recovery — off by default, deliberate opt-in (see
  // schema.prisma's comment on shop.notifyAbandonedCart).
  @IsOptional()
  @IsBoolean()
  notifyAbandonedCart?: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  abandonedCartWindowMinutes?: number;

  // Low Stock daily digest — off by default.
  @IsOptional()
  @IsBoolean()
  notifyLowStockDigest?: boolean;

  // Bill of Materials auto-deduction — on by default (see schema.prisma's
  // comment on shop.autoDeductIngredientStock for why this one defaults
  // differently from the notify* toggles above).
  @IsOptional()
  @IsBoolean()
  autoDeductIngredientStock?: boolean;

  // --- Store Configuration ---

  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessType?: string;

  @IsOptional()
  @IsIn(['en', 'ar'])
  defaultLanguage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultDeliveryFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  taxDisplayText?: string;

  @IsOptional()
  @IsIn(['grid', 'list'])
  productDisplayOrientation?: string;

  @IsOptional()
  @IsBoolean()
  productImageZoomEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showCategoryMenu?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPreOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  customerConfirmationRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  externalDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  asapDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryCalendarEnabled?: boolean;

  // JSON string — see shop.businessHours in schema.prisma for the shape.
  @IsOptional()
  @IsString()
  businessHours?: string;

  @IsOptional()
  @IsBoolean()
  whatsappFloatingButtonEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  birthdayDiscountEnabled?: boolean;

  // Which admin product-form experience this shop's merchants get — see
  // schema.prisma's comment on shop.productEditorMode.
  @IsOptional()
  @IsIn(['simple', 'advanced'])
  productEditorMode?: string;

  @IsOptional()
  @IsBoolean()
  customerSurveyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  dynamicThemeBuilderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  disableStoreCart?: boolean;

  @IsOptional()
  @IsIn(['buy_now', 'contact_to_order'])
  cartDisabledMode?: string;

  // --- Online Presence ---
  // Shape/domain validation happens in ShopService — keys and URL format
  // aren't expressible as a plain class-validator decorator here.
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  // --- Delivery & Pickup (business-level, shared across every outlet) ---
  // "At least one payment method per context" is checked in ShopService —
  // not expressible as a per-field decorator.

  @IsOptional()
  @IsBoolean()
  deliveryPaymentCardOnline?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryPaymentCashOnDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryPaymentCardOnDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupPaymentCardOnline?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupPaymentCashOnPickup?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupPaymentCardOnPickup?: boolean;

  @IsOptional()
  @IsObject()
  deliveryHours?: Record<
    string,
    { open: string; close: string; closed: boolean }
  >;

  @IsOptional()
  @IsObject()
  pickupHours?: Record<
    string,
    { open: string; close: string; closed: boolean }
  >;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryTimeSlotGapMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryPreparationTimeMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryPreparationPlusDeliveryTimeMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedDeliveryTimeFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimatedDeliveryTimeTo?: number;

  @IsOptional()
  @IsIn(['minutes', 'hours'])
  estimatedDeliveryTimeUnit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pickupTimeSlotGapMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pickupPreparationTimeMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pickupPreparationPlusTimeMinutes?: number;

  // --- Order Setting ---

  @IsOptional()
  @IsBoolean()
  allowSameDayOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  allowNextDayOrders?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  // paymentGateway is deliberately NOT settable here anymore — it moved to
  // PATCH /payment-settings/:provider, the only place that enforces the
  // nomod/stripe mutual-exclusivity rule. Leaving it reachable through this
  // generic shop-update endpoint too would let a direct API call bypass
  // that check entirely (whitelist:true + forbidNonWhitelisted:true on the
  // global ValidationPipe means a client that still sends it now gets a
  // clean 400, not a silent no-op). See PaymentSettingsService.
}
