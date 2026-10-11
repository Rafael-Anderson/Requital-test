import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PROOF_REQUIREMENTS = [
  'photo_or_otp',
  'photo',
  'otp',
  'none',
] as const;
export type ProofRequirement = (typeof PROOF_REQUIREMENTS)[number];

export const RUN_STATUSES = [
  'draft',
  'dispatched',
  'in_progress',
  'completed',
  'cancelled',
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// At most this many stops on one run: a bound so a request cannot ask the
// service to validate thousands of orders in one go.
export const MAX_STOPS_PER_RUN = 50;

export class CreateDeliveryRunDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  driverId: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'runDate must be YYYY-MM-DD' })
  runDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn(PROOF_REQUIREMENTS)
  proofRequirement?: ProofRequirement;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STOPS_PER_RUN)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  orderIds?: number[];
}

export class UpdateDeliveryRunDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  driverId?: number;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'runDate must be YYYY-MM-DD' })
  runDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn(PROOF_REQUIREMENTS)
  proofRequirement?: ProofRequirement;
}

export class AddStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STOPS_PER_RUN)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  orderIds: number[];
}

export class ReorderStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STOPS_PER_RUN)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  stopIds: number[];
}

export class ListDeliveryRunsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  driverId?: number;

  @IsOptional()
  @IsIn(RUN_STATUSES)
  status?: (typeof RUN_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ReadyOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}

export class SendLinkDto {
  @IsIn(['whatsapp'])
  channel: 'whatsapp';
}

export class CashReconciliationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  driverId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
