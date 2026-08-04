import { IsIn, IsInt, IsPositive } from 'class-validator';
import { INVOICE_TYPES, type InvoiceType } from '../invoices.constants';

export class CreateInvoiceDto {
  @IsInt()
  @IsPositive()
  orderId: number;

  @IsIn(INVOICE_TYPES)
  type: InvoiceType;
}
