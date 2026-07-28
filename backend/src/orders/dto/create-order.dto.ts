import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { EMIRATES } from '../constants';

class OrderItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  // Required when the product has options configured, omitted otherwise —
  // enforced in ProductsService.resolveOrderItems.
  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  // Admin-only manual price adjustment (phone orders, draft orders) — wins
  // over the product/variant's own price when set. Deliberately absent from
  // the public/storefront order DTO — a customer can never set their own price.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceOverride?: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  // Deliberately a free-text field — UAE addresses commonly rely on
  // landmarks/area names rather than a structured street format.
  @IsString()
  @IsNotEmpty()
  customerAddress: string;

  @IsIn(EMIRATES)
  emirate: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  deliveryTimeSlot?: string;

  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  receiverMessage?: string;

  // A merchant manually applying an affiliate code to an order entered
  // on their behalf — same resolution as the storefront flow (see
  // AffiliateService.resolveAttribution); an unknown/expired/blocked code is
  // silently ignored, never blocks order creation.
  @IsOptional()
  @IsString()
  referralCode?: string;

  // Re-validated and atomically claimed server-side at creation time (see
  // OrdersService.create) — a client-supplied discountAmount is never
  // trusted, only the code itself.
  @IsOptional()
  @IsString()
  discountCode?: string;

  // Attribution / source channel, e.g. "Website organic", "Instagram", "Walk-in".
  // Free text rather than an enum — channel names are marketing-defined and
  // open-ended, not a fixed set the backend needs to branch on.
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsIn(['delivery', 'pickup'])
  orderType?: string;

  // Required for an admin creating an order (they aren't scoped to one
  // outlet). Ignored for a branch user — the service always forces their
  // own outlet regardless of what's sent here.
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  // Omitted means "use the shop's defaultDeliveryFee at creation time" — see
  // OrdersService.create. 0 is valid and distinct from omitted (e.g. pickup).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInput)
  items: OrderItemInput[];
}
