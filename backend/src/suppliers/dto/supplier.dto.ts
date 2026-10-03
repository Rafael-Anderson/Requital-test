import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../shop/dto/update-shop.dto';
import { SUPPLIER_STATUSES } from '../supplier-constants';

// Every nullable field below is @IsOptional(), which class-validator also
// treats as "null is allowed": on PATCH, `null` clears the field (unknown), an
// absent key leaves it alone. Nothing is ever defaulted.
export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentTerms?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  leadTimeDays?: number | null;

  // ISO code from the same list a shop's own currency is gated by. NULL means
  // the merchant has not said, not AED.
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;

  // In the SUPPLIER's currency, so it needs one (checked in the service).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000_000)
  minimumOrderAmount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

// Hand-written rather than a PartialType: this project does not use
// @nestjs/mapped-types (see reports/dto/monthly-report-filter.dto.ts).
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsIn(SUPPLIER_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentTerms?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  leadTimeDays?: number | null;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000_000)
  minimumOrderAmount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class CreateSupplierContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  role?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateSupplierContactDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  role?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(191)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpsertSupplierItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  supplierSku?: string | null;

  // A RATE, so it keeps up to 4 decimals (a stem can cost 0.0125); it is not
  // rounded to the currency's minor unit. Amounts (line totals) are.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000_000)
  unitCost?: number | null;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minOrderQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  leadTimeDays?: number | null;
}
