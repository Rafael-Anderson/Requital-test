import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

// RULE_BASED templates only — every set field is ANDed together at
// evaluation time (see TemplatesService.resolveProductIds). Deliberately
// this small fixed shape, not a generic condition-builder — see the
// schema.prisma comment on `template.rules` for why.
export class TemplateRulesDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tagName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  createdWithinDays?: number;
}
