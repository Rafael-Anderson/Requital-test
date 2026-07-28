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
import { COLLECTION_TYPES, type CollectionType } from '../collection-constants';
import { CollectionRulesDto } from './collection-rules.dto';

export class UpdateCollectionDto {
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
  // convention as CategoryFormModal's image field.
  @IsOptional()
  @IsString()
  image?: string | null;

  @IsOptional()
  @IsIn(COLLECTION_TYPES)
  type?: CollectionType;

  @IsOptional()
  @ValidateNested()
  @Type(() => CollectionRulesDto)
  rules?: CollectionRulesDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
