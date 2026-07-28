import { IsString } from 'class-validator';

export class ValidateGiftCardDto {
  @IsString()
  code: string;
}
