import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Lightweight quick-create — name+price+category for a Product, name+unit
// for an Ingredient (see CommitScanItemDto.targetType for which fields
// apply). Full editing happens afterward in the normal product/ingredient
// pages, same as any other quick-create-then-refine flow in this app.
export class CommitScanNewItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

// A row the merchant chose not to skip on the review screen. There's no
// `skip` flag here — a skipped row is simply left out of the array the
// frontend posts, rather than round-tripped as a no-op.
export class CommitScanItemDto {
  @IsIn(['product', 'ingredient'])
  targetType: 'product' | 'ingredient';

  // Set when the merchant confirmed/picked an existing match — re-verified
  // against ctx.shopId server-side before it's trusted for anything (see
  // ScanService.commit), never taken at face value from the client.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  matchedId?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CommitScanNewItemDto)
  createNew?: CommitScanNewItemDto;
}

export class CommitScanDto {
  // The already-uploaded scan image's URL (from POST /scan/preview) — not
  // re-uploaded here, see ScanController.
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitScanItemDto)
  items: CommitScanItemDto[];
}
