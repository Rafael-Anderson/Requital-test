import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  BIO_LINK_SOCIAL_PLATFORMS,
  BIO_LINK_TYPES,
  type BioLinkSocialPlatform,
  type BioLinkType,
} from '../bio-link-constants';

export class CreateBioLinkDto {
  @IsIn(BIO_LINK_TYPES)
  type: BioLinkType;

  // Required for every type except SOCIAL_ICON (falls back to the platform's
  // display name) — enforced in BioLinksService, not here, since it depends
  // on the sibling `type` field.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  productId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  templateId?: number;

  @IsOptional()
  @IsIn(BIO_LINK_SOCIAL_PLATFORMS)
  socialPlatform?: BioLinkSocialPlatform;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
