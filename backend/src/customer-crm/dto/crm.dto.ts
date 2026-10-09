import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CONSENT_CHANNELS, CONSENT_STATUSES } from '../consent-wording';

export class CreateCustomerTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  // A #rrggbb value only: it ends up in a style attribute in the admin.
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a #rrggbb value' })
  color?: string;
}

export class UpdateCustomerTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a #rrggbb value' })
  color?: string;
}

// Bulk assign / unassign. Both lists are capped so one request cannot be a
// quarter-million-row write.
export class BulkTagDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  customerIds!: number[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  tagIds!: number[];
}

export class CreateCustomerNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class RecordConsentDto {
  @IsIn(CONSENT_CHANNELS)
  channel!: (typeof CONSENT_CHANNELS)[number];

  @IsIn(CONSENT_STATUSES)
  status!: (typeof CONSENT_STATUSES)[number];

  // How the answer was obtained. Required for a grant (a verbal "yes" or a form
  // must be traceable); optional for a withdrawal.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
