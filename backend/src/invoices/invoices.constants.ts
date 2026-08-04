export const INVOICE_TYPES = ['INVOICE', 'PACKING_SLIP'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
