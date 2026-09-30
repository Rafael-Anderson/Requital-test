import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';

// Phase 2b / PR-E. The drop of `emirate` from order / draftorder / outlet cannot be
// undone from its own file, so the migration refuses to run while a row still
// holds an emirate value no region carries. This runs the migration's real SQL
// (read from the file, not a copy) against TEMPORARY tables that shadow the real
// ones on a private connection, so the shared dev database is never touched.
const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20261003100000_drop_emirate_columns',
    'migration.sql',
  ),
  'utf8',
);
const TABLES = ['order', 'draftorder', 'outlet'] as const;

describe('20261003100000_drop_emirate_columns (e2e)', () => {
  let conn: Connection;

  beforeAll(async () => {
    conn = await createConnection({
      uri: process.env.DATABASE_URL,
      multipleStatements: true,
    });
  });
  afterAll(async () => {
    await conn.end();
  });

  beforeEach(async () => {
    // A lax session on purpose: the migration must force strict mode itself, or
    // the guard's NULL-into-NOT-NULL would be coerced to 0 and the drop would run.
    await conn.query(`SET SESSION sql_mode = ''`);
    for (const t of TABLES) {
      await conn.query(`DROP TEMPORARY TABLE IF EXISTS \`${t}\``);
      await conn.query(
        `CREATE TEMPORARY TABLE \`${t}\` (
           id INT AUTO_INCREMENT PRIMARY KEY,
           emirate VARCHAR(191) NULL,
           regionId INT NULL
         )`,
      );
    }
  });

  afterEach(async () => {
    for (const t of TABLES) {
      await conn.query(`DROP TEMPORARY TABLE IF EXISTS \`${t}\``);
    }
  });

  async function columns(table: string): Promise<string[]> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM \`${table}\``,
    );
    return rows.map((r) => String(r.Field));
  }

  it('drops the column from all three tables when every value is carried by a region or NULL', async () => {
    for (const t of TABLES) {
      await conn.query(
        `INSERT INTO \`${t}\` (emirate, regionId) VALUES ('Dubai', 3), (NULL, NULL), (NULL, 4)`,
      );
    }
    await conn.query(MIGRATION);
    for (const t of TABLES) {
      expect(await columns(t)).toEqual(['id', 'regionId']);
    }
  });

  it.each(TABLES)(
    'refuses, and drops nothing, while %s holds an emirate no region carries',
    async (table) => {
      await conn.query(
        `INSERT INTO \`${table}\` (emirate, regionId) VALUES ('Dubai', 3), ('Atlantis', NULL)`,
      );
      await expect(conn.query(MIGRATION)).rejects.toThrow(/null/i);
      for (const t of TABLES) {
        expect(await columns(t)).toContain('emirate');
      }
    },
  );

  it('an empty database passes the guard (a fresh CI database)', async () => {
    await conn.query(MIGRATION);
    for (const t of TABLES) {
      expect(await columns(t)).not.toContain('emirate');
    }
  });
});
