import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// This is the autosave target (PATCH /themes/:id) — updates the live draft
// `config` only, never `publishedConfig`. `config` is loosely typed here
// (validated for shape in theme-config.validation.ts at the service
// boundary) rather than a bespoke nested class-validator schema, same
// "loosely typed here, validated in the service" convention
// UpdateThemeDto.colors already uses in the legacy theme module.
export class UpdateThemeDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
