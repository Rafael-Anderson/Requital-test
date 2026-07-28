import { IsDateString, IsNumber, IsOptional, IsPositive } from 'class-validator';

// Admin-issued only (customer service credit, promotions) — a
// storefront-purchased card is generated internally by
// GiftCardsService.issueForOrder, never through this endpoint.
export class CreateGiftCardDto {
  @IsNumber()
  @IsPositive()
  initialValue: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
