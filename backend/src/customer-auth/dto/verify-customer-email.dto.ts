import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyCustomerEmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token: string;
}
