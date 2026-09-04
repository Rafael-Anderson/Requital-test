import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TEMPLATE_KEYS } from '../templates';

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

  // Phase G0 — start from one of the built-in starter templates
  // (backend/src/themes/templates.ts). Mutually exclusive with
  // duplicateFromId. Omitted (and no duplicateFromId) -> DEFAULT_THEME_CONFIG.
  @IsOptional()
  @IsString()
  @IsIn(TEMPLATE_KEYS as unknown as string[])
  fromTemplate?: string;
}
