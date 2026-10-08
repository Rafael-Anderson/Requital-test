import type { PoolConnection } from 'mysql2/promise';
import type { DatabaseService, QueryParam } from '../database/database.service';

// Shared by the staff service (a stop was removed) and the driver app (a stop
// was resolved): complete a run once nothing is pending, and kill its links with
// it. Single conditional UPDATEs, so two callers racing cannot both complete it
// and a run that still has a pending stop (or none at all) is untouched.
//
// `Exec` abstracts "run this statement, tell me affectedRows" so a caller inside
// a transaction hands over its own `conn` and never the pool (nested-pool rule).
export type Exec = (sql: string, params: QueryParam[]) => Promise<number>;

export const connExec =
  (conn: PoolConnection): Exec =>
  async (sql, params) => {
    const [res] = await conn.query(sql, params);
    return (res as { affectedRows: number }).affectedRows;
  };

export const poolExec =
  (db: DatabaseService): Exec =>
  async (sql, params) =>
    (await db.execute(sql, params)).affectedRows;

export async function completeRunIfDone(
  exec: Exec,
  shopId: number,
  runId: number,
): Promise<boolean> {
  const done = await exec(
    `UPDATE deliveryrun r SET r.status = 'completed', r.completedAt = NOW(3), r.updatedAt = NOW(3)
      WHERE r.id = ? AND r.shopId = ? AND r.status IN ('dispatched', 'in_progress')
        AND EXISTS (SELECT 1 FROM deliveryrunstop s WHERE s.runId = r.id)
        AND NOT EXISTS (SELECT 1 FROM deliveryrunstop s WHERE s.runId = r.id AND s.status = 'pending')`,
    [runId, shopId],
  );
  if (done === 0) return false;
  await exec(
    `UPDATE deliveryrunlink SET revokedAt = NOW(3)
      WHERE runId = ? AND shopId = ? AND revokedAt IS NULL`,
    [runId, shopId],
  );
  return true;
}
