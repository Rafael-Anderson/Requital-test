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

export class UpdateTaxClassDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate?: number;

  @IsOptional()
  @IsIn(TAX_CLASS_TYPES)
  type?: string;

  // Setting this true moves the default here and clears it everywhere else in
  // the shop, in one transaction. Setting it false is rejected — a shop with no
  // default class has nothing for an unassigned product to fall back to.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
