import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';

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
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends RowDataPacket[]>(
    sql: string,
    params: QueryParam[] = [],
  ): Promise<T> {
    const [rows] = await this.pool.execute<T>(sql, params);
    return rows;
  }

  async execute(sql: string, params: QueryParam[] = []): Promise<ResultSetHeader> {
    const [result] = await this.pool.execute<ResultSetHeader>(sql, params);
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
