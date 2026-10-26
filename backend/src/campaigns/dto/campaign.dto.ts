import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCampaignDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // A subject is one header line: no control characters at all (CR/LF above all).
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]+$/, {
    message: 'subject must be a single line',
  })
  subject!: string;

  // Sanitised server-side (common/sanitize-html.ts) before it is stored.
  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  bodyHtml!: string;

  @IsOptional()
  @IsInt()
  segmentId?: number | null;
}

export class UpdateCampaignDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]+$/, {
    message: 'subject must be a single line',
  })
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  bodyHtml?: string;

  // null clears the segment (the whole consented audience).
  @IsOptional()
  @IsInt()
  segmentId?: number | null;
}
