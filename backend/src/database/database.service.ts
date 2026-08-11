import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import type { TypeCastField, TypeCastNext } from 'mysql2';

// mysql2's own ExecuteValues type, minus the Blob/nested-array/object
// variants this codebase never needs to pass as a bound parameter.
export type QueryParam = string | number | bigint | boolean | Date | null | Buffer;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      // Deliberately small — this migration exists because Hostinger's
      // shared-hosting thread cap crashed Prisma's engine. Don't recreate a
      // similar ceiling problem with an oversized pool.
      connectionLimit: Number(process.env.DB_POOL_SIZE ?? 5),
      // DECIMAL columns come back as JS strings rather than lossy floats/BigInt.
      decimalNumbers: false,
      // MySQL has no native boolean type — Boolean columns are TINYINT(1),
      // and mysql2 returns those as raw 0/1 numbers by default (unlike
      // Prisma, which mapped them to real JS booleans). Cast TINYINT(1)
      // specifically, not every TINYINT, so a genuine small-integer column
      // isn't silently turned into a boolean.
      typeCast: (field: TypeCastField, next: TypeCastNext) => {
        if (field.type === 'TINY' && field.length === 1) {
          const value = field.string();
          return value === null ? null : value === '1';
        }
        return next();
      },
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  // Deliberately pool.query(), not pool.execute() — mysql2's prepared-
  // statement (execute) protocol rejects bound LIMIT/OFFSET parameters on
  // this MySQL setup ("Incorrect arguments to mysqld_stmt_execute"), which
  // is fatal for essentially every paginated list query in this codebase.
  // .query() does client-side parameter escaping instead of the binary
  // prepared-statement protocol — still fully injection-safe via the same
  // `?` placeholder syntax, just without that LIMIT/OFFSET restriction.
  async query<T extends RowDataPacket[]>(
    sql: string,
    params: QueryParam[] = [],
  ): Promise<T> {
    const [rows] = await this.pool.query<T>(sql, params);
    return rows;
  }

  async execute(sql: string, params: QueryParam[] = []): Promise<ResultSetHeader> {
    const [result] = await this.pool.query<ResultSetHeader>(sql, params);
    return result;
  }

  async transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
