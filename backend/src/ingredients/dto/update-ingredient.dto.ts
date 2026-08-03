import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  // Explicit null clears the image; undefined leaves it unchanged — same
  // convention as CategoryDto's image field.
  @IsOptional()
  @IsString()
  image?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerUnit?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplier?: string | null;

  // Explicit null unassigns the category; undefined leaves it unchanged —
  // same convention as CategoryDto's parentCategoryId.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  categoryId?: number | null;
}
