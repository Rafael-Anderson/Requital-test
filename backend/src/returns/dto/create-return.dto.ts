import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';
import { RETURN_REASONS } from '../returns.constants';

class ReturnItemDto {
  @IsInt()
  @IsPositive()
  orderItemId: number;

  @IsInt()
  @IsPositive()
  quantity: number;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsIn(RETURN_REASONS)
  reason: (typeof RETURN_REASONS)[number];

  // Defaults to true in the service — admin unchecks only for damaged goods
  // that shouldn't go back into sellable stock.
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  // Defaults to the sum of priceAtPurchase * returnedQty across the
  // requested items — editable, same "trust but let staff override" pattern
  // as the bulk price update.
  @IsOptional()
  @IsNumber()
  @Min(0)
  refundAmount?: number;
}
