import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class DeliverStopDto {
  // The customer's one-time code, exactly six digits.
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code' })
  code?: string;

  // What the driver took in cash, in the order's currency. Accepted as a string
  // or a JSON number and normalised to text; the service parses it with exact
  // decimal arithmetic against the ORDER's currency (so a 3-decimal KWD amount is
  // legal and a 3-decimal AED one is not).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' ? String(value) : value,
  )
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,3})?$/, {
    message: 'cashCollected must be a plain amount',
  })
  cashCollected?: string;
}

export class FailStopDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;
}
