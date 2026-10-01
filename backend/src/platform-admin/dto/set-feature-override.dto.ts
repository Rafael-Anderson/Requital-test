import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetFeatureOverrideDto {
  @IsBoolean()
  enabled!: boolean;

  // Why staff did this; shown on the shop's platform page and in the audit log.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
