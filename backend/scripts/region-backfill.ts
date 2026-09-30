// The region backfill's report, and the one half of it SQL cannot do.
//
//   npx ts-node -r tsconfig-paths/register scripts/region-backfill.ts            # READ-ONLY report
//   npx ts-node -r tsconfig-paths/register scripts/region-backfill.ts --apply-addresses
//
// The order / draftorder / outlet backfills are plain UPDATEs inside migration
// 20261001110000. This script (a) reports, per table, how many rows mapped, how
// many had nothing to map (source emirate NULL) and how many held a value that
// matched no region, and (b) with --apply-addresses stamps `regionId` into the
// customer.addresses JSON (idempotent). It prints counts and region names only,
// never customer data. "Unmatched" is expected to be 0 on any database whose
// emirates all came through the old validator; anything else is a bug or a data
// problem to look at, not something to default away.
import 'dotenv/config';
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { mapAddressRegions } from '../src/customer-account/address-regions';

const TABLES = ['order', 'draftorder', 'outlet'] as const;

async function main() {
  const apply = process.argv.includes('--apply-addresses');
  const pool = createPool({ uri: process.env.DATABASE_URL });
  try {
    for (const t of TABLES) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total,
                SUM(regionId IS NOT NULL) AS mapped,
                SUM(emirate IS NULL) AS sourceNull,
                SUM(emirate IS NOT NULL AND regionId IS NULL) AS unmatched
           FROM \`${t}\``,
      );
      const r = rows[0];
      console.log(
        `${t}: total=${r.total} mapped=${r.mapped ?? 0} sourceNull=${r.sourceNull ?? 0} unmatched=${r.unmatched ?? 0}`,
      );
      const [bad] = await pool.query<RowDataPacket[]>(
        `SELECT emirate, COUNT(*) AS n FROM \`${t}\`
          WHERE emirate IS NOT NULL AND regionId IS NULL GROUP BY emirate`,
      );
      for (const b of bad)
        console.log(`  unmatched value: "${b.emirate}" x${b.n}`);
    }

    const [shops] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(countryCode IS NULL) AS noCode FROM shop`,
    );
    console.log(
      `shop: total=${shops[0].total} countryCodeNull=${shops[0].noCode ?? 0}`,
    );

    const [regions] = await pool.query<RowDataPacket[]>(
      `SELECT countryCode, id, nameEn FROM region`,
    );
    const byCountry = new Map<string, Map<string, number>>();
    for (const g of regions) {
      const m = byCountry.get(g.countryCode) ?? new Map<string, number>();
      m.set(String(g.nameEn).toLowerCase(), g.id);
      byCountry.set(g.countryCode, m);
    }

    const [customers] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.addresses, s.countryCode
         FROM customer c JOIN shop s ON s.id = c.shopId
        WHERE c.addresses IS NOT NULL`,
    );
    let mapped = 0;
    let already = 0;
    const unmapped = new Map<string, number>();
    for (const c of customers) {
      const names = byCountry.get(c.countryCode) ?? new Map<string, number>();
      const r = mapAddressRegions(c.addresses, names);
      mapped += r.mapped;
      already += r.alreadyMapped;
      for (const u of r.unmapped) unmapped.set(u, (unmapped.get(u) ?? 0) + 1);
      if (apply && r.mapped > 0) {
        await pool.execute(`UPDATE customer SET addresses = ? WHERE id = ?`, [
          JSON.stringify(r.addresses),
          c.id,
        ]);
      }
    }
    console.log(
      `customer.addresses: customers=${customers.length} ${apply ? 'mapped' : 'wouldMap'}=${mapped} alreadyMapped=${already} unmatchedValues=${unmapped.size}`,
    );
    for (const [v, n] of unmapped)
      console.log(`  unmatched value: "${v}" x${n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
