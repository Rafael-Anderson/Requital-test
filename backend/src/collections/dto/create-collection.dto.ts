import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { COLLECTION_SORT_KEYS } from '../collection-sort';
import { CollectionRulesFieldsDto } from './collection-rule.dto';

export class CreateCollectionDto extends CollectionRulesFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // Auto-derived from name if omitted (see CollectionsService.create).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by hyphens',
  })
  slug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  parentCollectionId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  // URL/path to an already-uploaded image (see POST /collections/upload).
  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  // Rendered on the collection page's own banner (storefront-v2 Phase 2A).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // The order the storefront collection page opens in when the customer has not picked
  // one (?sort= always wins). Must be a key the page already offers; NULL (explicit null
  // on update clears it) = Newest, the page's own default.
  @IsOptional()
  @IsIn(COLLECTION_SORT_KEYS)
  defaultSort?: string | null;
}
