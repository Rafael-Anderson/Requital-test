import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';

class TemplateProductInput {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

// Full replace, same convention as UpdateProductOptionsDto/ReorderBioLinksDto
// — the caller sends the complete desired membership+order every time, the
// server doesn't try to diff/merge against what's currently there. MANUAL
// templates only (see TemplatesService.setProducts).
export class SetTemplateProductsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateProductInput)
  products: TemplateProductInput[];
}
