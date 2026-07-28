import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateOrderNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}
