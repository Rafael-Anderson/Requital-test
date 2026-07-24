import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateShopDto {
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

  @IsOptional()
  @IsBoolean()
  productVariantsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  productAttributesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  productFaqsEnabled?: boolean;

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
  @IsBoolean()
  disableGoogleMaps?: boolean;

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
  deliveryHours?: Record<string, { open: string; close: string; closed: boolean }>;

  @IsOptional()
  @IsObject()
  pickupHours?: Record<string, { open: string; close: string; closed: boolean }>;

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
}
