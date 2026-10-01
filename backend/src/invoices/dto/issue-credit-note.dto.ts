import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { CREDIT_NOTE_REASONS, type CreditNoteReason } from '../invoices.constants';

export class IssueCreditNoteDto {
  @IsInt()
  @IsPositive()
  orderId: number;

  // 'return' credits one specific return (returnId required); the other two
  // credit the whole invoice (returnId must be absent).
  @IsIn(CREDIT_NOTE_REASONS)
  reason: CreditNoteReason;

  @IsOptional()
  @IsInt()
  @IsPositive()
  returnId?: number;
}
