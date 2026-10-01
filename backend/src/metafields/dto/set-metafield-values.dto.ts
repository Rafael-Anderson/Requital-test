import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class MetafieldValueInputDto {
  @IsInt()
  definitionId: number;

  // Absent or null removes the value. Anything else is checked against the
  // definition by validateMetafieldValue.
  @IsOptional()
  value?: unknown;
}

export class SetMetafieldValuesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MetafieldValueInputDto)
  values: MetafieldValueInputDto[];
}
