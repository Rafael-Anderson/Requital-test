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
// Read-only. Works against both the pre-billing and the post-billing code, since
// it only calls FeaturesService.getFlags and plain SELECTs.
import 'dotenv/config';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../src/database/database.service';
import { FeaturesService } from '../src/features/features.service';

const SHOP_COLS = [
  'id', 'name', 'subdomain', 'currency', 'published', 'suspendedAt',
  'sliderEnabled', 'customerSurveyEnabled', 'notifyEmail', 'notifyCustomersWhatsapp',
  'notifyAbandonedCart', 'notifyLowStockDigest', 'autoDeductIngredientStock',
  'whatsappFloatingButtonEnabled', 'productImageZoomEnabled', 'showCollectionMenu',
];
const ORDER_COLS = [
  'id', 'shopId', 'outletId', 'shopOrderNumber', 'currency', 'total', 'status', 'createdAt',
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
    const shops = await db.query<RowDataPacket[]>(`SELECT id FROM shop ORDER BY id`);
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
          order: await checksum('order', ORDER_COLS),
          shopfeatureoverride: await checksum('shopfeatureoverride', [
            'shopId', 'featureKey', 'enabled', 'note',
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
