import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;

  @IsOptional()
  @IsString()
  ogImage?: string;

  // Low modern SEO value (search engines mostly ignore it), kept only for
  // parity with the reference platform — don't over-index on this field.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  keywords?: string;
}
