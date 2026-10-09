import { NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';
import { compileRules, parseRules, type CompiledPredicate } from './segment-rules';

// Loads a segment by id IN THE CALLER'S SHOP (another shop's id is a 404) and
// returns its predicate. The stored JSON is re-validated on every load, so a row
// written by anything other than the service (a bad migration, a manual edit)
// still cannot reach the SQL compiler unchecked.
export async function loadSegmentPredicate(
  db: DatabaseService,
  shopId: number,
  segmentId: number,
): Promise<CompiledPredicate> {
  const rows = await db.query<RowDataPacket[]>(
    `SELECT rules FROM customersegment WHERE id = ? AND shopId = ?`,
    [segmentId, shopId],
  );
  if (rows.length === 0) throw new NotFoundException(`Segment ${segmentId} not found`);
  const raw: unknown =
    typeof rows[0].rules === 'string' ? JSON.parse(rows[0].rules) : rows[0].rules;
  return compileRules(parseRules(raw));
}
