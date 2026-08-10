import type { QueryParam } from './database.service';

// Builds a `SET col = ?, col2 = ?` clause + matching params from a partial
// DTO-shaped object, skipping any key whose value is `undefined` (a field
// the caller didn't send) — the mysql2 equivalent of Prisma's `data: dto`
// partial-update convenience. Returns null when nothing was actually sent,
// so the caller can short-circuit to just re-reading the row unchanged.
export function buildSetClause(
  values: Record<string, QueryParam | undefined>,
): { setClause: string; params: QueryParam[] } | null {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  const setClause = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
  const params = entries.map(([, v]) => v as QueryParam);
  return { setClause, params };
}
