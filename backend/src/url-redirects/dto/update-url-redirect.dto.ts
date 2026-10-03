import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateUrlRedirectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  fromPath?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  toTarget?: string;

  @IsOptional()
  @IsIn([301, 302])
  statusCode?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
