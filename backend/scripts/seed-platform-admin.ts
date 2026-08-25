// Creates (or updates the password of) the first platform admin. Deliberately
// CLI-only — there is no signup route for this tier, by design (see
// CLAUDE.md's platform-admin section): anyone who can run this script
// already has production DB/deploy access, which is the actual security
// boundary here, not an HTTP endpoint.
//
// Usage: npx ts-node -r tsconfig-paths/register scripts/seed-platform-admin.ts <email> <password> <name>
import 'dotenv/config';
import { createPool } from 'mysql2/promise';
import * as bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ');
  if (!email || !password || !name) {
    console.error(
      'Usage: seed-platform-admin.ts <email> <password> <name>',
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const pool = createPool({ uri: process.env.DATABASE_URL });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.execute(
    `INSERT INTO platformadmin (email, passwordHash, name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash), name = VALUES(name)`,
    [email, passwordHash, name],
  );
  console.log(`Platform admin ready: ${email}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
