import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  // `null` clears the logo; `undefined` (omitted) leaves it untouched —
  // @IsOptional() lets a null through, buildSetClause writes it as NULL.
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoUrl?: string | null;
}
