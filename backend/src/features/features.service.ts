import { Injectable } from '@nestjs/common';
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import type { ShopfeatureoverrideRow } from '../db/types';
import {
  FEATURE_KEY_LIST,
  FEATURE_KEYS,
  type FeatureDef,
  type FeatureKey,
} from './feature-keys';

export type FeatureFlags = Record<FeatureKey, boolean>;

// Hook for PLT-1 (billing/plans). There are no plans, so it answers "no
// opinion" for everything and the chain falls through to the registry default.
// Deliberately not a fake plan table: when billing exists this is the single
// place that starts returning a value. NOTE enabledShopIds() below resolves in
// SQL and does not call this; it must learn the plan layer at the same time
// (features.service.spec.ts asserts the two agree, so the gap cannot go unseen).
export const planDefault: (
  shopId: number,
  key: FeatureKey,
) => boolean | undefined = () => undefined;

// Precedence, highest first: platform override row, the shop column (column-
// backed keys only), plan default, registry default. Pure so the table-backed
// path can be exercised without a registered table-backed key.
export function resolveFlag(
  def: FeatureDef,
  override: boolean | undefined,
  columnValue: boolean | null | undefined,
  plan: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  if (def.source === 'column' && columnValue != null) return columnValue;
  return plan ?? def.default;
}

export interface FeatureOverrideView {
  enabled: boolean;
  note: string | null;
  updatedBy: number | null;
  updatedAt: Date;
}

export interface FeatureStatus {
  key: FeatureKey;
  description: string;
  source: FeatureDef['source'];
  default: boolean;
  // The merchant's own column value; null for table-backed keys.
  columnValue: boolean | null;
  override: FeatureOverrideView | null;
  effective: boolean;
}

// Widen the literal registry type so both `source` arms stay reachable.
const defOf = (key: FeatureKey): FeatureDef => FEATURE_KEYS[key];

const COLUMNS = [
  ...new Set(
    FEATURE_KEY_LIST.flatMap((k) => {
      const def = defOf(k);
      return def.source === 'column' ? [def.column] : [];
    }),
  ),
];

// The only place in the backend allowed to read a registry-backed shop column
// (tools/check-feature-flags.js enforces it). Every read is scoped by the shop
// id the caller already derived from the authenticated user / resolved slug,
// so one shop's override can never reach another shop.
@Injectable()
export class FeaturesService {
  constructor(private readonly db: DatabaseService) {}

  // Pass `conn` to read inside the caller's transaction instead of taking a
  // second pool connection.
  private async rows<T extends RowDataPacket>(
    conn: PoolConnection | undefined,
    sql: string,
    params: QueryParam[],
  ): Promise<T[]> {
    if (conn) {
      const [rows] = await conn.query<T[]>(sql, params);
      return rows;
    }
    return this.db.query<T[]>(sql, params);
  }

  private async load(shopId: number, conn?: PoolConnection) {
    const [shopRows, overrideRows] = await Promise.all([
      COLUMNS.length
        ? this.rows<RowDataPacket>(
            conn,
            `SELECT ${COLUMNS.map((c) => `\`${c}\``).join(', ')} FROM shop WHERE id = ?`,
            [shopId],
          )
        : this.rows<RowDataPacket>(conn, `SELECT id FROM shop WHERE id = ?`, [
            shopId,
          ]),
      this.rows<ShopfeatureoverrideRow & RowDataPacket>(
        conn,
        `SELECT * FROM shopfeatureoverride WHERE shopId = ?`,
        [shopId],
      ),
    ]);
    return { shop: shopRows[0] ?? null, overrides: overrideRows };
  }

  private static statuses(
    shopId: number,
    shop: RowDataPacket,
    overrides: ShopfeatureoverrideRow[],
  ): FeatureStatus[] {
    const byKey = new Map(overrides.map((o) => [o.featureKey, o]));
    return FEATURE_KEY_LIST.map((key) => {
      const def = defOf(key);
      const o = byKey.get(key);
      const columnValue =
        def.source === 'column' && shop[def.column] != null
          ? Boolean(shop[def.column])
          : null;
      return {
        key,
        description: def.description,
        source: def.source,
        default: def.default,
        columnValue,
        override: o
          ? {
              enabled: Boolean(o.enabled),
              note: o.note,
              updatedBy: o.updatedBy,
              updatedAt: o.updatedAt,
            }
          : null,
        effective: resolveFlag(
          def,
          o ? Boolean(o.enabled) : undefined,
          columnValue,
          planDefault(shopId, key),
        ),
      };
    });
  }

  // Every key for one shop in two queries. A shop that does not exist has every
  // feature off: unknown is never a plausible default.
  async getFlags(shopId: number, conn?: PoolConnection): Promise<FeatureFlags> {
    const { shop, overrides } = await this.load(shopId, conn);
    const flags = {} as FeatureFlags;
    if (!shop) {
      for (const k of FEATURE_KEY_LIST) flags[k] = false;
      return flags;
    }
    for (const s of FeaturesService.statuses(shopId, shop, overrides)) {
      flags[s.key] = s.effective;
    }
    return flags;
  }

  async isEnabled(
    shopId: number,
    key: FeatureKey,
    conn?: PoolConnection,
  ): Promise<boolean> {
    return (await this.getFlags(shopId, conn))[key];
  }

  // Full per-key breakdown for the platform admin page. Null = no such shop.
  async describe(shopId: number): Promise<FeatureStatus[] | null> {
    const { shop, overrides } = await this.load(shopId);
    return shop ? FeaturesService.statuses(shopId, shop, overrides) : null;
  }

  // For the cron sweeps that used to filter on the column in SQL. Same
  // precedence as isEnabled, resolved in the query. Identifiers come from the
  // registry constants, never from input.
  async enabledShopIds(key: FeatureKey): Promise<number[]> {
    const def = defOf(key);
    const base =
      def.source === 'column' ? `s.\`${def.column}\`` : String(+def.default);
    const rows = await this.db.query<({ id: number } & RowDataPacket)[]>(
      `SELECT s.id FROM shop s
         LEFT JOIN shopfeatureoverride o ON o.shopId = s.id AND o.featureKey = ?
        WHERE COALESCE(o.enabled, ${base}) = 1
        ORDER BY s.id`,
      [key],
    );
    return rows.map((r) => r.id);
  }

  // The write half. Called only from the platform-admin service, inside the
  // transaction that also writes the audit entry.
  async setOverride(
    conn: PoolConnection,
    shopId: number,
    key: FeatureKey,
    enabled: boolean,
    note: string | null,
    platformAdminId: number,
  ): Promise<void> {
    await conn.query(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled, note, updatedBy)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), note = VALUES(note),
                               updatedBy = VALUES(updatedBy)`,
      [shopId, key, enabled, note, platformAdminId],
    );
  }

  async clearOverride(
    conn: PoolConnection,
    shopId: number,
    key: FeatureKey,
  ): Promise<boolean> {
    const [result] = await conn.query<ResultSetHeader>(
      `DELETE FROM shopfeatureoverride WHERE shopId = ? AND featureKey = ?`,
      [shopId, key],
    );
    return result.affectedRows > 0;
  }
}
