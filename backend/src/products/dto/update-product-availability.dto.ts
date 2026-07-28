import { IsIn } from 'class-validator';
import { PRODUCT_STATUSES } from './create-product.dto';
import type { ProductStatus } from './create-product.dto';

// Deliberately the only field this endpoint accepts — see
// products.controller.ts for why this is split out from UpdateProductDto:
// a branch user is allowed to flip a product's availability (their outlet's
// day-to-day reality) but must not be able to sneak a name/price/category
// change through the same request.
export class UpdateProductAvailabilityDto {
  @IsIn(PRODUCT_STATUSES)
  status: ProductStatus;
}
