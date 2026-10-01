export const INVOICE_TYPES = ['INVOICE', 'PACKING_SLIP'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

// Credit notes share invoicecounter for their CN-0001 sequence but are NOT an
// InvoiceType: they live in their own table, and adding the value to
// INVOICE_TYPES would let POST /invoices mint one.
export const CREDIT_NOTE_COUNTER_TYPE = 'CREDIT_NOTE' as const;
export const CREDIT_NOTE_REASONS = ['return', 'cancellation', 'correction'] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];
