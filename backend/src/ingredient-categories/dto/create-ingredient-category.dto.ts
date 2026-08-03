import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateIngredientCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
