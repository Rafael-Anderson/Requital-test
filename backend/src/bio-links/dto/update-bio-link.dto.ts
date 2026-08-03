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

export class UpdateBioLinkDto {
  @IsOptional()
  @IsIn(BIO_LINK_TYPES)
  type?: BioLinkType;

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
  categoryId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

  @IsOptional()
  @IsIn(BIO_LINK_SOCIAL_PLATFORMS)
  socialPlatform?: BioLinkSocialPlatform;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
