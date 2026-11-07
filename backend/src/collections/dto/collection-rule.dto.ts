import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MATCH_MODES,
  MAX_RULES,
  MAX_VALUE_LENGTH,
  RULE_OPERATORS,
} from '../collection-rules';

// One condition. The field/operator pair is checked against the allowlist in
// collection-rules.ts (validateRules) by the service, which knows which operators
// each field supports; here only the shape and the hard caps are enforced.
export class CollectionRuleDto {
  @IsString()
  @MaxLength(32)
  field: string;

  @IsIn(RULE_OPERATORS)
  operator: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_VALUE_LENGTH)
  value?: string | null;
}

export class PreviewRulesDto {
  @IsIn(MATCH_MODES)
  matchMode: string;

  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => CollectionRuleDto)
  rules: CollectionRuleDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
