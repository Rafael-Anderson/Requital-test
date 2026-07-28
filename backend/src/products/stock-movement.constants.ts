// Plain-string discriminated values, same convention as every other
// non-enum status field in this schema (discount.type, draftorder.status,
// etc.) — enforced via class-validator @IsIn() at the DTO boundary, not a
// real Prisma enum.
export const ADJUSTMENT_REASONS = ['received', 'damaged', 'recount', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const STOCK_MOVEMENT_TYPES = ['ADJUSTMENT', 'TRANSFER', 'RETURN', 'IMPORT', 'RECEIVED', 'CONSUMED'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
