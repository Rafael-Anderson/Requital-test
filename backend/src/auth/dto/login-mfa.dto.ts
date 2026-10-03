import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginMfaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;

  // A 6 digit TOTP code or a recovery code.
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}
