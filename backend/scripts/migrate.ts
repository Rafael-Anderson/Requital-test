// Replaces `npx prisma migrate deploy`. Applies backend/prisma/migrations/
// (already hand-authored plain MySQL DDL, zero Prisma-specific syntax) in
// timestamp order, tracking applied ones in a plain `_migrations` table
// instead of Prisma's `_prisma_migrations`.
import 'dotenv/config';
import { createPool } from 'mysql2/promise';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

interface CountRow {
  c: number;
}
interface NameRow {
  name: string;
}
interface MigrationNameRow {
  migration_name: string;
}

async function main() {
  const pool = createPool({
    uri: process.env.DATABASE_URL,
    multipleStatements: true,
  });
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    // One-time seed from Prisma's own tracking table so an existing database
    // (every real dev/staging/prod DB predates this runner) doesn't try to
    // re-run already-applied migrations the first time this script runs.
    const [hasOldTableRows] = await conn.query<(CountRow & { c: number })[] & any>(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'`,
    );
    const [alreadySeededRows] = await conn.query<any>(
      `SELECT COUNT(*) AS c FROM _migrations`,
    );
    const hasOldTable = Number((hasOldTableRows as CountRow[])[0].c);
    const alreadySeeded = Number((alreadySeededRows as CountRow[])[0].c);

    if (hasOldTable > 0 && alreadySeeded === 0) {
      const [rows] = await conn.query<any>(
        `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
      );
      for (const row of rows as MigrationNameRow[]) {
        await conn.execute(`INSERT IGNORE INTO _migrations (name) VALUES (?)`, [
          row.migration_name,
        ]);
      }
      console.log(
        `Seeded _migrations from _prisma_migrations (${(rows as unknown[]).length} rows).`,
      );
    }

    const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(); // timestamp-prefixed folder names -> lexicographic sort is chronological

    const [appliedRows] = await conn.query<any>(`SELECT name FROM _migrations`);
    const applied = new Set((appliedRows as NameRow[]).map((r) => r.name));

    let appliedCount = 0;
    for (const folder of folders) {
      if (applied.has(folder)) continue;
      const sqlPath = join(MIGRATIONS_DIR, folder, 'migration.sql');
      if (!existsSync(sqlPath)) continue;

      console.log(`Applying ${folder}...`);
      await conn.beginTransaction();
      try {
        // multipleStatements:true is safe here — this script only ever
        // reads our own committed migration files, never user input.
        await conn.query(readFileSync(sqlPath, 'utf8'));
        await conn.execute(`INSERT INTO _migrations (name) VALUES (?)`, [folder]);
        await conn.commit();
        appliedCount++;
      } catch (err) {
        await conn.rollback();
        console.error(`Migration ${folder} failed:`, err);
        process.exit(1);
      }
    }
    console.log(
      appliedCount > 0
        ? `Applied ${appliedCount} migration(s).`
        : 'No pending migrations.',
    );
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
