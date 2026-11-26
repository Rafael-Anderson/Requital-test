import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_ORDER_LINES } from '../../common/order-limits';
import { MAX_REASON_LENGTH } from '../draft-order-constants';
import { DraftOrderItemInput } from './draft-order-item.dto';

const PHONE = /^\+?[0-9][0-9\s-]{5,19}$/;

// Every field a draft can hold, all optional. CreateDraftOrderDto and
// UpdateDraftOrderDto add their own required-ness on top; PreviewDraftOrderDto
// is this shape as it stands (the builder previews an unsaved form).
export class DraftOrderFieldsDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  customerName?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE, {
    message:
      'customerPhone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerEmail?: string;

  // Required for delivery when a link is sent or the order is converted; a
  // pickup order uses the outlet.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerAddress?: string;

  // The region, by id. Options come from GET /regions.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  area?: string;

  @IsOptional()
  @IsIn(['delivery', 'pickup'])
  orderType?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'deliveryDate must be YYYY-MM-DD',
  })
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  deliveryTimeSlot?: string;

  // Both or neither (checked in the service, as at checkout).
  @IsOptional()
  @IsString()
  @MaxLength(191)
  receiverName?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE, {
    message:
      'receiverPhone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  receiverPhone?: string;

  // The gift message (order.receiverMessage).
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  receiverMessage?: string;

  // A code of the shop's own discounts. Explicit null clears it (update).
  @IsOptional()
  discountCode?: string | null;

  // A staff discount instead of a code: percent (0-100) or a fixed amount,
  // with a reason. Explicit null type clears it (update).
  @IsOptional()
  @IsIn(['percent', 'fixed', null])
  orderDiscountType?: 'percent' | 'fixed' | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  orderDiscountValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  orderDiscountReason?: string;

  // Replaces the fee the delivery zones give. Explicit null clears it (update).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  deliveryFeeOverride?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  deliveryFeeOverrideReason?: string;

  // Staff only: never shown to the customer, never copied to the order.
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  // Shown to the customer on the pay page and carried to order.deliveryNotes.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => DraftOrderItemInput)
  items?: DraftOrderItemInput[];
}
