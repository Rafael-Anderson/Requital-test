import { IsOptional, IsString, MaxLength } from 'class-validator';

// Mirrors backend/src/seo/dto/update-seo.dto.ts, plus explicit-null support
// on the two image fields: `undefined`/omitted leaves the field untouched
// (Prisma skips it in the upsert data), but `null` genuinely clears it back
// to "inherit Theme's logo/banner" — a real, distinct action the admin
// Remove button needs (@IsOptional() treats both null and undefined as
// "skip further validation", so this is safe either way).
export class UpdateBioPageConfigDto {
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  backgroundUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;
}
