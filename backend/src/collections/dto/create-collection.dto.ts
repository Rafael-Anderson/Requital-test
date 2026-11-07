import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { COLLECTION_TYPES, MATCH_MODES, MAX_RULES } from '../collection-rules';
import { CollectionRuleDto } from './collection-rule.dto';

export class CreateCollectionDto {
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

  // 'manual' (default): products are assigned from the product form. 'automated':
  // members are computed from `rules` at read time.
  @IsOptional()
  @IsIn(COLLECTION_TYPES)
  collectionType?: string;

  @IsOptional()
  @IsIn(MATCH_MODES)
  matchMode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => CollectionRuleDto)
  rules?: CollectionRuleDto[];
}
