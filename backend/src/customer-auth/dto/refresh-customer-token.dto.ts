import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshCustomerTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
