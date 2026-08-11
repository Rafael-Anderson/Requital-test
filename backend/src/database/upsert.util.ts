import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import type { QueryParam } from './database.service';

// Generic INSERT ... ON DUPLICATE KEY UPDATE helper — MySQL resolves the
// conflicting key (primary or unique) itself, so one helper covers every
// composite-PK/composite-unique upsert in the schema without needing to name
// the constraint. Not for increment-on-conflict upserts (e.g. stock
// transfers) — write those as their own raw SQL instead, see
// outletingredientstock's transfer path.
export async function upsert(
  runner: Pool | PoolConnection,
  table: string,
  values: Record<string, QueryParam>,
  updateColumns: string[] = Object.keys(values),
): Promise<ResultSetHeader> {
  const columns = Object.keys(values);
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const updateClause = updateColumns
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');
  // .query(), not .execute() — see DatabaseService's own comment: mysql2's
  // prepared-statement protocol has proven unreliable on this MySQL setup.
  const [result] = await runner.query<ResultSetHeader>(
    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    columns.map((c) => values[c]),
  );
  return result;
}
