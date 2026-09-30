// Mark an order's issued invoices as no longer describing that order.
//
// C1 froze the invoice document at issue, which is what an invoice has to be.
// The consequence is that an invoice can now legitimately disagree with its own
// order: edit the items, change the delivery fee, cancel, or process a return,
// and the frozen document remains a correct record of what was issued while no
// longer describing what the order is. Staff need to see that rather than hand a
// customer a document that quietly contradicts the live order.
//
// A PLAIN FUNCTION, not a service. InvoicesModule already imports OrdersModule
// (InvoicesService needs OrdersService.findOne), so an injected
// InvoicesService in OrdersService would be a circular dependency. A function
// taking the caller's own connection sidesteps that and joins the transaction the
// caller already has, so the marking commits or rolls back with the change that
// caused it.

// The minimum surface both a DatabaseService and a mysql2 PoolConnection satisfy.
export interface SupersedeExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export async function markInvoicesSuperseded(
  exec: SupersedeExecutor,
  orderId: number,
  at: Date = new Date(),
): Promise<void> {
  await exec.query(
    // `type = 'INVOICE'` only. A PACKING_SLIP is a live document by design (it
    // renders from the order every time and its cash-to-collect is the current
    // total), so it cannot be out of date and must not be flagged as if it were.
    //
    // `supersededAt IS NULL` keeps the FIRST divergence rather than overwriting
    // it on every later edit: "this invoice stopped describing the order at
    // 14:02" is the useful fact, and it makes repeated calls idempotent.
    `UPDATE invoice SET supersededAt = ?
      WHERE orderId = ? AND type = 'INVOICE' AND supersededAt IS NULL`,
    [at, orderId],
  );
}
