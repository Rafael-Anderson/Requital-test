// Same plain-string discriminated convention as every other status field in
// this schema — see stock-movement.constants.ts.
export const RETURN_REASONS = ['damaged', 'wrong_item', 'changed_mind', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
