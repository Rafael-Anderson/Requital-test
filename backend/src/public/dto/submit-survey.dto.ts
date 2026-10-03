import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitSurveyDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // The customer's answer to "You may show my feedback on the store's
  // website". Omitted by an older client = unknown (NULL), never consent.
  @IsOptional()
  @IsBoolean()
  publishConsent?: boolean;
}
