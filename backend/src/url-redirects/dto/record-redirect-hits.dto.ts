import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RedirectHitDto {
  @IsString()
  @MaxLength(1000)
  path: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  count: number;
}

export class RecordRedirectHitsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RedirectHitDto)
  hits: RedirectHitDto[];
}
