import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TAX_CLASS_TYPES } from '../tax-class-constants';

export class CreateTaxClassDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  // A percentage. Max 100 rather than an open number: the column is
  // DECIMAL(5,2), so anything above 999.99 would be a silent out-of-range
  // write, and no VAT rate anywhere is above 100%.
  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;

  @IsIn(TAX_CLASS_TYPES)
  type: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
