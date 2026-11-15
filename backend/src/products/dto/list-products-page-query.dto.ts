import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAGE_SIZE_MAX } from '../../common/pagination';
import { ListProductsQueryDto } from './list-products-query.dto';

// GET /products. With neither `page` nor `pageSize` the whole catalogue comes back
// as an array, exactly as before (pickers and exports rely on that). With either,
// the answer is one page: { data, page, pageSize, total }.
export class ListProductsPageQueryDto extends ListProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  pageSize?: number;

  // Only products hand-assigned to this collection (the same links the product
  // form edits). Another shop's collection id simply matches nothing.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  collectionId?: number;

  // Name, SKU or barcode contains this text.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
