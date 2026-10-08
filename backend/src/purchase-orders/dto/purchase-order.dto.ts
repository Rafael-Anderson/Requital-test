import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../shop/dto/update-shop.dto';
import { PO_STATUSES } from '../purchase-order-rules';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// One PO line. Exactly one of `ingredientId` / `productId` (a product-level
// pick resolves to its shadow ingredient, with `variantId` for a variant); the
// service enforces the XOR and validates every id against the caller's shop.
export class PurchaseOrderLineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ingredientId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;

  // Whole units: stock is an integer column.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  // A rate in the PO's currency, up to 4 decimals. Omitted: filled from the
  // supplier's catalogue when its currency matches the PO's, else refused.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  supplierSku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class CreatePurchaseOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId: number;

  // The receiving outlet. A branch user's own outlet always wins.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  // Overrides the supplier's currency. One of the two must exist: a PO is never
  // priced in a guessed currency.
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expectedAt must be YYYY-MM-DD' })
  expectedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'expectedAt must be YYYY-MM-DD' })
  expectedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class ReplacePurchaseOrderLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

export class ReceiveLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lineId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  // What this delivery was actually invoiced at. Omitted: the ordered price.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  unitCost?: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(191)
  deliveryNoteRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  // A retry with the same key returns the original receipt instead of posting
  // stock a second time.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  idempotencyKey?: string;
}

export class ScanPendingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lineId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity: number;
}

// INV-3. A scan resolves a barcode or SKU to ONE open line of this PO and checks
// the draft tally against what is still outstanding. It writes nothing: the tally
// is committed through POST :id/receive, the same path as the receive modal.
export class ScanPurchaseOrderLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  code: string;

  // Units this scan adds (a case scan can add more than one).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  // The tally already scanned in this session, so the server can refuse an
  // over-receive before the commit instead of letting the commit fail later.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScanPendingDto)
  pending?: ScanPendingDto[];
}

export class ListPurchaseOrdersQueryDto {
  @IsOptional()
  @IsIn(PO_STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

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
