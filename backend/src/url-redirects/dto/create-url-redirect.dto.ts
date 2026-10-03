import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Only the shape is checked here; every path/target SAFETY rule lives in
// redirect-rules.ts and runs in the service (it needs the shop's own hosts,
// which a DTO validator cannot know).
export class CreateUrlRedirectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  fromPath: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  toTarget: string;

  @IsOptional()
  @IsIn([301, 302])
  statusCode?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
