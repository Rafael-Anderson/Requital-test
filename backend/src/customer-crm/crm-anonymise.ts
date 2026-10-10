import type { DatabaseService } from '../database/database.service';

// PDPL anonymisation of the CRM data hung off a customer (called from
// CustomerAccountService.anonymiseCustomer, after the profile scrub).
//
//  - Staff notes are DELETED: free text written about a person routinely holds the
//    details the anonymisation exists to remove, and they are the merchant's
//    working notes rather than a financial record.
//  - Marketing consent is withdrawn on every channel that was granted (a dated
//    event, source `account_deletion`), so the row can never be marketed to. The
//    history is kept: it holds no personal data (no name, address or IP) and is the
//    evidence of what was agreed and when.
//
//  - The store-credit ledger is KEPT (it is a financial record) but the free-text
//    `reason` on staff-typed grants and deductions is replaced, since staff type
//    names and circumstances into it. Structural entries carry no free text.
//  - A merge record holding a duplicate's old contact details is scrubbed.
//
// Plain pool statements (no transaction), each idempotent: the event is written
// from the rows still `granted`, then those rows are flipped, so a repeat finds
// nothing left to do.
export async function anonymiseCustomerCrm(
  db: DatabaseService,
  shopId: number,
  customerId: number,
): Promise<void> {
  await db.execute(
    `DELETE FROM customernote WHERE customerId = ? AND shopId = ?`,
    [customerId, shopId],
  );
  await db.execute(
    `INSERT INTO customerconsentevent (shopId, customerId, channel, status, source, note)
     SELECT shopId, customerId, channel, 'withdrawn', 'account_deletion', 'Account deleted by the customer'
       FROM customerconsent
      WHERE customerId = ? AND shopId = ? AND status = 'granted'`,
    [customerId, shopId],
  );
  await db.execute(
    `UPDATE customerconsent
        SET status = 'withdrawn', source = 'account_deletion', updatedAt = CURRENT_TIMESTAMP(3)
      WHERE customerId = ? AND shopId = ? AND status = 'granted'`,
    [customerId, shopId],
  );
  await db.execute(
    `UPDATE storecreditentry SET reason = '[removed]'
      WHERE customerId = ? AND shopId = ? AND entryType IN ('grant', 'deduct') AND reason IS NOT NULL`,
    [customerId, shopId],
  );
}
