import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
import { EMIRATES } from '../../orders/constants';

class DraftOrderItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  // Required when the product has options configured — same rule as a
  // regular order's items (see ProductsService.resolveOrderItems).
  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  // Omitted = the product/variant's current price (resolved at add time,
  // not kept in sync afterward — see draftorderitem.price). Set = a manual
  // adjustment, the reason draft orders carry an editable price at all.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;
}

export class CreateDraftOrderDto {
  @IsInt()
  @IsPositive()
  outletId: number;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  // Required (not left null) even though the schema column is nullable —
  // completing a draft reuses OrdersService.create verbatim, whose
  // CreateOrderDto requires both fields already; asking for them up front
  // avoids inventing a placeholder default ("N/A") at conversion time.
  @IsString()
  @IsNotEmpty()
  customerAddress: string;

  @IsIn(EMIRATES)
  emirate: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsIn(['delivery', 'pickup'])
  orderType?: string;

  // Resolved against DiscountsService at create/update time (see
  // DraftOrdersService) — an invalid/expired/exhausted code is rejected
  // immediately rather than silently accepted and failing later at
  // completion, so the admin building the draft sees the problem right away.
  @IsOptional()
  @IsString()
  discountCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DraftOrderItemInput)
  items?: DraftOrderItemInput[];
}
