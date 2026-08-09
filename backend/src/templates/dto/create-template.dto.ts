import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TEMPLATE_TYPES, type TemplateType } from '../template-constants';
import { TemplateRulesDto } from './template-rules.dto';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  // Auto-derived from title if omitted (see TemplatesService — same
  // convention as collection/product slug resolution).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsIn(TEMPLATE_TYPES)
  type: TemplateType;

  // Required (and must have at least one field set) when type is
  // RULE_BASED, forbidden for MANUAL — enforced in TemplatesService since
  // it depends on the sibling `type` field.
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateRulesDto)
  rules?: TemplateRulesDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
