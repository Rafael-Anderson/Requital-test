import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PRODUCT_OPTIONS } from '../variant-generator';

class ProductOptionInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  // Free text values, e.g. ["Small", "Medium", "Large"] — order in the
  // array is the display/reorder order (see ProductsService.updateOptions).
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  values: string[];
}

// Full replace, same convention as categoryIds/tags on UpdateProductDto — an
// empty array removes all options and reverts the product to a single
// implicit variant (deletes every productoption/productvariant row for it).
export class UpdateProductOptionsDto {
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionInput)
  options: ProductOptionInput[];
}
