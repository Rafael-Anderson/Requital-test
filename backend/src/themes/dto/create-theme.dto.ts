import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateThemeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  // Deep-clones that theme's own config (verified same-shop) with fresh
  // section ids — see ThemesService.create. Omitted -> starts from
  // DEFAULT_THEME_CONFIG.
  @IsOptional()
  @IsInt()
  duplicateFromId?: number;
}
