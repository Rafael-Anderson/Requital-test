import { IsNotEmpty, IsString } from 'class-validator';

export class SendWhatsAppTestMessageDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}
