import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { COLLECTION_SORT_KEYS } from '../collection-sort';
import { CollectionRulesFieldsDto } from './collection-rule.dto';

export class UpdateCollectionDto extends CollectionRulesFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by hyphens',
  })
  slug?: string;

  // Explicit null moves the collection to the root (no parent); undefined
  // means "leave unchanged" — IsOptional only skips validation on those two,
  // so null still reaches the service as a real value.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  parentCollectionId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  // Explicit null clears the image; undefined leaves it unchanged — same
  // convention as parentCollectionId above.
  @IsOptional()
  @IsString()
  image?: string | null;

  // The Featured Collections icon. Explicit null clears it, undefined leaves it unchanged.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

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
