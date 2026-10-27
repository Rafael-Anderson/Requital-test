import type { DatabaseService } from '../database/database.service';

// Ends a campaign that is `sending` and cannot continue (or has finished). One CAS
// on the status, so a repeat or a race changes nothing. Unclaimed recipients are
// skipped with a reason; claimed-but-unreported ones are left to the sender's
// stale-claim sweep, never re-sent.
export async function stopCampaign(
  db: DatabaseService,
  campaignId: number,
  shopId: number,
  status: 'failed' | 'sent',
  reason: string | null,
): Promise<boolean> {
  const res = await db.execute(
    `UPDATE campaign SET status = ?, failureReason = ?, completedAt = ?, updatedAt = ?
      WHERE id = ? AND shopId = ? AND status = 'sending'`,
    [status, reason, new Date(), new Date(), campaignId, shopId],
  );
  if (res.affectedRows > 0 && status === 'failed') {
    await db.execute(
      `UPDATE campaignrecipient SET status = 'skipped', note = 'campaign stopped'
        WHERE campaignId = ? AND shopId = ? AND status = 'pending' AND claimedAt IS NULL`,
      [campaignId, shopId],
    );
  }
  return res.affectedRows > 0;
}
