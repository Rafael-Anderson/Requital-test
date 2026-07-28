import { IsIn } from 'class-validator';

// Only 'approved' | 'blocked' — the merchant payout-approval action can only
// move a commission out of 'pending', never back into it (see
// AffiliateService.updateOrderStatus).
export class UpdateAffiliateOrderStatusDto {
  @IsIn(['approved', 'blocked'])
  status: 'approved' | 'blocked';
}
