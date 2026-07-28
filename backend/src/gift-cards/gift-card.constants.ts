// What an admin can set by hand: disable a card, or re-enable a previously
// disabled one. 'redeemed' is never admin-settable — it's fully derived
// from remainingBalance (see GiftCardsService.syncStatus), which redeem()/
// creditRefund() keep in sync automatically as balance moves.
export const GIFT_CARD_ADMIN_STATUSES = ['disabled', 'active'] as const;

export const GIFT_CARD_REJECTION_MESSAGES = {
  not_found: 'This gift card code was not found',
  disabled: 'This gift card has been disabled',
  expired: 'This gift card has expired',
  no_balance: 'This gift card has no remaining balance',
} as const;
export type GiftCardRejectionReason = keyof typeof GIFT_CARD_REJECTION_MESSAGES;
