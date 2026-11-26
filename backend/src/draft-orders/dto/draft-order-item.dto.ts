import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_LINE_QUANTITY } from '../../common/order-limits';
import { MAX_REASON_LENGTH } from '../draft-order-constants';

// One builder line. Either a catalogue product (productId, optional variant)
// or a custom item (customName + price, no product). Cross-field rules (a
// custom line needs a price; an overridden catalogue price needs a reason) are
// checked in DraftOrdersService.normaliseItems, where the message can name the
// line.
export class DraftOrderItemInput {
  @IsOptional()
  @IsInt()
  @IsPositive()
  productId?: number;

  // Required when the product has options configured — same rule as a
  // regular order's items (see ProductsService.resolveOrderItems).
  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  // Catalogue line: omitted = the product/variant's own current price (with any
  // auto-discount), set = a manual price that needs `priceReason`.
  // Custom line: the item's price (required).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  priceReason?: string;

  // Set = a custom item with this name (not tracked in inventory).
  @IsOptional()
  @IsString()
  @MaxLength(191)
  customName?: string;

  // Custom items only: false = no tax on this line. Default true.
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;
}
