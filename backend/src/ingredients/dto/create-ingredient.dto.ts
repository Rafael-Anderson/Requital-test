import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplier?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  categoryId?: number;
}
