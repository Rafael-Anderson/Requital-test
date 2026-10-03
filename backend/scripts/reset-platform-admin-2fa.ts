// Removes the second factor (and recovery codes) of ONE platform admin, for the
// case where they lost their device and their recovery codes. Deliberately
// CLI-only, like seed-platform-admin.ts: there is no platform admin above a
// platform admin to do this over HTTP, and whoever can run this already has
// production DB access, which is the real boundary. The admin simply signs in
// with their password again and re-enrols (or, with PLATFORM_REQUIRE_2FA on, is
// held in the enrolment-only scope until they do).
//
// Usage: npx ts-node -r tsconfig-paths/register scripts/reset-platform-admin-2fa.ts <email>
import 'dotenv/config';
import { createPool } from 'mysql2/promise';

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: reset-platform-admin-2fa.ts <email>');
    process.exit(1);
  }
  const pool = createPool({ uri: process.env.DATABASE_URL });
  const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT id FROM platformadmin WHERE email = ?`,
    [email],
  );
  if (!rows[0]) {
    console.error(`No platform admin with email ${email}`);
    await pool.end();
    process.exit(1);
  }
  const id = rows[0].id as number;
  await pool.query(
    `DELETE FROM platformadminrecoverycode WHERE platformAdminId = ?`,
    [id],
  );
  await pool.query(`DELETE FROM platformadmintotp WHERE platformAdminId = ?`, [
    id,
  ]);
  console.log(`Two-factor removed for platform admin ${email}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
