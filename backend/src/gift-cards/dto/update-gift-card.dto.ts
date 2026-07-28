import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { GIFT_CARD_ADMIN_STATUSES } from '../gift-card.constants';

export class UpdateGiftCardDto {
  // 'active'/'redeemed' are auto-managed off remainingBalance (see
  // GiftCardsService.syncStatus) — an admin can only ever move a card
  // to/from 'disabled' by hand. 'expired' is set by the expiry check, not
  // hand-picked either (picking an arbitrary expiresAt in the past to force
  // it is the equivalent, more useful action).
  @IsOptional()
  @IsIn(GIFT_CARD_ADMIN_STATUSES)
  status?: (typeof GIFT_CARD_ADMIN_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
