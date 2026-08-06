import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteUploadDto {
  @IsString()
  @IsNotEmpty()
  key!: string;
}
