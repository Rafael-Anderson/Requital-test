import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

class AbandonedCartItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  variantLabel?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsString()
  thumbnail: string;
}

// Fired by the storefront checkout page once a shopper has entered enough
// contact info to be reachable (name + phone) — not on every keystroke, see
// the checkout form's own call site. Same phone-format rule as
// CreatePublicOrderDto.customerPhone, deliberately kept in sync since this
// is the same field, just captured earlier in the flow.
export class CaptureAbandonedCartDto {
  @IsString()
  customerName: string;

  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'customerPhone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  customerPhone: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AbandonedCartItemInput)
  cartItems: AbandonedCartItemInput[];
}
