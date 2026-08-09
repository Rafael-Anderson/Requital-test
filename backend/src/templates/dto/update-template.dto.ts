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

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

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

  // Explicit null clears the image; undefined leaves it unchanged — same
  // convention as CollectionFormModal's image field.
  @IsOptional()
  @IsString()
  image?: string | null;

  @IsOptional()
  @IsIn(TEMPLATE_TYPES)
  type?: TemplateType;

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
