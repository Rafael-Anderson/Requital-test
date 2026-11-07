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
  COLLECTION_TYPES,
  MATCH_MODES,
  MAX_RULES,
  MAX_RULE_VALUE_LENGTH,
  RULE_FIELD_KEYS,
  RULE_OPERATORS,
} from '../collection-rules';

export class CollectionRuleDto {
  @IsIn(RULE_FIELD_KEYS)
  field: string;

  @IsIn(RULE_OPERATORS)
  operator: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RULE_VALUE_LENGTH)
  value?: string;
}

// Mixed into create/update: collection type, match mode and the condition list.
export class CollectionRulesFieldsDto {
  @IsOptional()
  @IsIn(COLLECTION_TYPES)
  collectionType?: string;

  @IsOptional()
  @IsIn(MATCH_MODES)
  matchMode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RULES)
  @ValidateNested({ each: true })
  @Type(() => CollectionRuleDto)
  rules?: CollectionRuleDto[];
}

export class PreviewCollectionRulesDto {
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
