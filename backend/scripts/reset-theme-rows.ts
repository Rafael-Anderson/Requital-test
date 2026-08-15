// One-time data reset for the Shopify-parity theme builder rework — every
// existing `theme` row's `config`/`publishedConfig` was written against
// PR #31's old flat shape (elements[], 8-field GlobalThemeSettings) and is
// invalid against the new recursive section->block->sub-block shape this
// rework ships. Per the plan's explicit scope decision, no production
// merchant data exists yet, so this resets rows to the new
// DEFAULT_THEME_CONFIG rather than building compatibility parsing for the
// old shape. Prints what it found before touching anything — run this,
// read its output, and only let it proceed if the printed rows are
// genuinely test data.
import 'dotenv/config';
import { createPool, type RowDataPacket } from 'mysql2/promise';
import { DEFAULT_THEME_CONFIG } from '../src/themes/constants';

interface ThemeRow extends RowDataPacket {
  id: number;
  shopId: number;
  name: string;
  isPublished: number;
  config: unknown;
  shopName: string;
  shopEmail: string | null;
  shopSubdomain: string;
}

async function main() {
  const pool = createPool({ uri: process.env.DATABASE_URL });

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM theme WHERE deletedAt IS NULL`,
  );
  const count = countRows[0].count as number;
  console.log(`theme rows (not soft-deleted): ${count}`);

  if (count === 0) {
    console.log('Nothing to reset.');
    await pool.end();
    return;
  }

  const [rows] = await pool.query<ThemeRow[]>(
    `SELECT t.id, t.shopId, t.name, t.isPublished, t.config,
            s.name AS shopName, s.email AS shopEmail, s.subdomain AS shopSubdomain
     FROM theme t JOIN shop s ON s.id = t.shopId
     WHERE t.deletedAt IS NULL
     ORDER BY t.id`,
  );

  console.log('\nAll rows (shop context printed so this can be visually confirmed as test data):');
  for (const row of rows) {
    const configPreview = JSON.stringify(row.config).slice(0, 300);
    console.log(
      `  theme #${row.id} "${row.name}" (published=${!!row.isPublished}) — shop #${row.shopId} "${row.shopName}" <${row.shopEmail ?? 'no email'}> @${row.shopSubdomain}`,
    );
    console.log(`    config: ${configPreview}${configPreview.length >= 300 ? '…' : ''}`);
  }

  const looksLikeRealMerchant = rows.some(
    (r) => !/test|dev|demo|example/i.test(r.shopEmail ?? '') && !/test|dev|demo|example/i.test(r.shopSubdomain),
  );
  console.log(
    `\nHeuristic check (shop email/subdomain containing test/dev/demo/example): ${
      looksLikeRealMerchant ? 'SOME ROWS LOOK LIKE THEY MIGHT BE REAL — STOPPING, review manually.' : 'all rows look like test/dev data.'
    }`,
  );

  // A real merchant's unpublished draft was found in production once (2026-08-15) —
  // the heuristic above correctly stopped rather than silently resetting it. This
  // flag is the explicit "I've reviewed the printed rows above by hand and want to
  // proceed anyway" override for that case — never pass it without actually reading
  // the row list first. Unpublished rows are safe to reset regardless (a customer
  // never saw them; the storefront only ever renders publishedConfig for real
  // traffic), but a *published* real-merchant row would need a real decision, not
  // this flag.
  if (looksLikeRealMerchant && !process.argv.includes('--confirm-real-shops')) {
    console.log('Re-run with --confirm-real-shops (in addition to --apply) once you have reviewed the rows above.');
    await pool.end();
    process.exit(1);
  }

  if (process.argv.includes('--apply')) {
    const defaultConfigJson = JSON.stringify(DEFAULT_THEME_CONFIG);
    await pool.query(
      `UPDATE theme SET config = CAST(? AS JSON), publishedConfig = CASE WHEN isPublished = 1 THEN CAST(? AS JSON) ELSE NULL END WHERE deletedAt IS NULL`,
      [defaultConfigJson, defaultConfigJson],
    );
    console.log(`\nReset ${count} row(s) to the new DEFAULT_THEME_CONFIG.`);
  } else {
    console.log('\nDry run only (no --apply flag) — nothing was changed. Re-run with --apply to actually reset.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
