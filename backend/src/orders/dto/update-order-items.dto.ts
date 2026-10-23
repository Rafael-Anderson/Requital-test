import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from '../../common/order-limits';

class OrderItemEdit {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  // Same admin-only override as CreateOrderDto's own item shape — never
  // exposed on any public/storefront DTO.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceOverride?: number;
}

// The FULL desired new item list, not a patch — the server diffs it
// against the order's current orderitem rows itself (see
// OrdersService.updateItems). Simpler and less error-prone than separate
// add/remove/adjust endpoints for what is, underneath, one operation:
// "this order's items are now this list."
export class UpdateOrderItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => OrderItemEdit)
  items: OrderItemEdit[];
}
