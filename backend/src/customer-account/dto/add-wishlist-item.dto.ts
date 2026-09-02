import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

// The wishlist stores bare product ids (see CustomerAccountService) — this
// is the only field the POST body carries. Ownership/availability of the id
// is checked in the service against ctx.shopId, never trusted from here.
export class AddWishlistItemDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  productId: number;
}
