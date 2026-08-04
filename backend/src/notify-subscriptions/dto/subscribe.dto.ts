import { IsEmail, IsInt, IsOptional, IsPositive } from 'class-validator';

export class SubscribeDto {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsEmail()
  email: string;
}
