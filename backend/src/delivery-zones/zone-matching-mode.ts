import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';

// Which rule decides a shop's delivery zone at checkout.
//
//   'legacy'  a zone is matched by comparing its free-text NAME with the
//             customer's area, then emirate (plus the map circle, SHP-1);
//   'regions' a zone is matched by the customer's region against the zone's
//             region set (plus the map circle). The zone's name is a label only.
//
// A shop flips to 'regions' the moment EVERY ACTIVE zone it owns has had its
// region mapping reviewed and confirmed by a merchant (mappingConfirmedAt), or it
// has no active zones at all, so there is nothing to map. Until then nothing about
// its fees changes: a silent switch would re-price live deliveries.
//
// Derived on every read rather than stored, so it cannot drift from the zones.
// The legacy branch is removed, along with this function's 'legacy' answer, once
// no shop reports it (platform admin GET /platform-admin/zone-mapping-status).
export type ZoneMatchingMode = 'legacy' | 'regions';

export async function getZoneMatchingMode(
  db: DatabaseService,
  shopId: number,
): Promise<{ mode: ZoneMatchingMode; unconfirmedActiveZones: number }> {
  const rows = await db.query<({ n: number } & RowDataPacket)[]>(
    `SELECT COUNT(*) AS n
       FROM deliveryzone dz JOIN outlet o ON o.id = dz.outletId
      WHERE o.shopId = ? AND dz.isActive = 1 AND dz.mappingConfirmedAt IS NULL`,
    [shopId],
  );
  const unconfirmedActiveZones = Number(rows[0]?.n ?? 0);
  return {
    mode: unconfirmedActiveZones === 0 ? 'regions' : 'legacy',
    unconfirmedActiveZones,
  };
}
