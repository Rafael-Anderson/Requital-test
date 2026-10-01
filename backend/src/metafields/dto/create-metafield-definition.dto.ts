import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { METAFIELD_OWNER_TYPES, METAFIELD_TYPES } from '../metafield-types';

// namespace.key is the stable public handle (it becomes the key in the public
// product payload), so it is a small lowercase identifier, not free text.
const IDENT = /^[a-z][a-z0-9_]{0,39}$/;

export class CreateMetafieldDefinitionDto {
  @IsIn(METAFIELD_OWNER_TYPES)
  ownerType: string;

  @Matches(IDENT, {
    message:
      'namespace must be lowercase letters, digits or underscores, starting with a letter (max 40)',
  })
  namespace: string;

  @Matches(IDENT, {
    message:
      'key must be lowercase letters, digits or underscores, starting with a letter (max 40)',
  })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @IsIn(METAFIELD_TYPES)
  type: string;

  // Shape depends on `type`; checked by normalizeValidationConfig.
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  visibleOnStorefront?: boolean;
}
