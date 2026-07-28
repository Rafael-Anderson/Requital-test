import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // Free text, e.g. "stems", "grams", "pieces" — merchant-defined, not a
  // fixed enum (see the schema field's own comment).
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit: string;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;
}
