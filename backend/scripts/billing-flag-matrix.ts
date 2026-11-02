// PLT-1 cutover proof. Prints, as JSON, (1) the effective feature-flag matrix for
// every shop and (2) COUNT(*) + BIT_XOR(per-row MD5) checksums over an EXPLICIT
// column list of shop and order (never GROUP_CONCAT, which truncates at
// group_concat_max_len). Run it before and after the billing migrations and
// require `diff` to be empty:
//
//   npx ts-node -r tsconfig-paths/register scripts/billing-flag-matrix.ts > before.json
//   npm run db:migrate
//   npx ts-node -r tsconfig-paths/register scripts/billing-flag-matrix.ts > after.json
//   diff before.json after.json
//
// Read-only. It calls FeaturesService.getFlags and plain SELECTs, and it runs the
// FeaturesService of whatever checkout it is run from, so the code and the schema
// must agree: FeaturesService (since PLT-1) joins shopsubscription/planfeature, so
// run it BEFORE the migrations only from the OLD checkout (old code, old schema) and
// AFTER from the NEW one (tools/deploy/deploy.sh does exactly that, with the PIN's
// copy of this script run from each tree in turn). It is NOT safe to run the new
// code against a pre-billing schema (the join fails on the missing table).
//
// The two documents are therefore not byte-identical when a release adds a feature
// key: the old code knows N keys, the new one N+k. Compare them with
// tools/deploy/lib/matrix-diff.js (per-shop key intersection must match, every
// AFTER-only key must be false), not with plain `diff`.
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../src/database/database.service';
import { FeaturesService } from '../src/features/features.service';

// Columns that do not exist before a migration adds them. They are checksummed in
// their own object (null when the column is absent) so the base `shop` checksum
// stays comparable across the migration. suspensionReason is added by
// 20261124100000 and backfilled by 20261124110000.
const OPTIONAL_SHOP_COLUMN = 'suspensionReason';

const SHOP_COLS = [
  'id',
  'name',
  'subdomain',
  'currency',
  'published',
  'suspendedAt',
  'sliderEnabled',
  'customerSurveyEnabled',
  'notifyEmail',
  'notifyCustomersWhatsapp',
  'notifyAbandonedCart',
  'notifyLowStockDigest',
  'autoDeductIngredientStock',
  'whatsappFloatingButtonEnabled',
  'productImageZoomEnabled',
  'showCollectionMenu',
];
const ORDER_COLS = [
  'id',
  'shopId',
  'outletId',
  'shopOrderNumber',
  'currency',
  'total',
  'status',
  'createdAt',
];

const rowHash = (cols: string[]) =>
  `CAST(CONV(SUBSTRING(MD5(CONCAT_WS('|', ${cols
    .map((c) => `IFNULL(\`${c}\`, '~NULL~')`)
    .join(', ')})), 1, 16), 16, 10) AS UNSIGNED)`;

async function main() {
  const db = new DatabaseService();
  try {
    const features = new FeaturesService(db);
    const checksum = async (table: string, cols: string[]) => {
      const [r] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n, CAST(BIT_XOR(${rowHash(cols)}) AS CHAR) AS x FROM \`${table}\``,
      );
      return { count: Number(r.n), bitXor: String(r.x) };
    };
    const hasSuspensionReason =
      Number(
        (
          await db.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = 'shop' AND column_name = ?`,
            [OPTIONAL_SHOP_COLUMN],
          )
        )[0].n,
      ) > 0;
    const shopSuspension = hasSuspensionReason
      ? {
          ...(await checksum('shop', ['id', OPTIONAL_SHOP_COLUMN])),
          // suspended shops with no reason: the backfill must have given every
          // suspended shop one, so this is 0 after the billing seed.
          suspendedWithoutReason: Number(
            (
              await db.query<RowDataPacket[]>(
                `SELECT COUNT(*) AS n FROM shop WHERE suspendedAt IS NOT NULL AND \`${OPTIONAL_SHOP_COLUMN}\` IS NULL`,
              )
            )[0].n,
          ),
        }
      : null;
    const shops = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop ORDER BY id`,
    );
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const s of shops) {
      matrix[String(s.id)] = Object.fromEntries(
        Object.entries(await features.getFlags(Number(s.id))).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    console.log(
      JSON.stringify(
        {
          shop: await checksum('shop', SHOP_COLS),
          shopSuspension,
          order: await checksum('order', ORDER_COLS),
          shopfeatureoverride: await checksum('shopfeatureoverride', [
            'shopId',
            'featureKey',
            'enabled',
            'note',
          ]),
          matrix,
        },
        null,
        1,
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
