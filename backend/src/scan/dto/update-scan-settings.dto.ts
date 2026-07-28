import { IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export const UNMATCHED_BEHAVIORS = ['ask', 'create'] as const;
export type UnmatchedBehavior = (typeof UNMATCHED_BEHAVIORS)[number];

export class UpdateScanSettingsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includeKeywords?: string[];

  // Explicit null clears back to "no default outlet".
  @IsOptional()
  @IsInt()
  @IsPositive()
  defaultOutletId?: number | null;

  @IsOptional()
  @IsIn(UNMATCHED_BEHAVIORS)
  unmatchedBehavior?: UnmatchedBehavior;
}
