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

// PLT-1 entitlement ceiling. effective = override ?? (entitled && preferred):
//   override  - a platform row, wins in both directions (comp, or force off)
//   entitled  - the shop's plan includes the key. A missing subscription or a
//               missing planfeature row means entitled (fail open, section 5.2):
//               a billing gap must never switch a merchant's feature off. Every
//               legacy shop is entitled to everything, so today's result is
//               unchanged for every existing shop.
//   preferred - the merchant's own switch (the shop column, else the registry
//               default). A plan never rewrites it, so an upgrade restores it.
// Pure so the table-backed path can be exercised without a registered key.
export function resolveFlag(
  def: FeatureDef,
  override: boolean | undefined,
  columnValue: boolean | null | undefined,
  entitled: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  const preferred =
    def.source === 'column' && columnValue != null ? columnValue : def.default;
  return (entitled ?? true) && preferred;
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
  // Does the shop's plan include this key. 'default' = no plan row decides it
  // (no subscription, or no planfeature row), so it is entitled by fail-open.
  entitled: boolean;
  entitledBy: 'plan' | 'default';
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
    const [shopRows, overrideRows, planRows] = await Promise.all([
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
      this.rows<{ featureKey: string; entitled: boolean } & RowDataPacket>(
        conn,
        `SELECT pf.featureKey, pf.entitled
           FROM shopsubscription ss
           JOIN planfeature pf ON pf.planId = ss.planId
          WHERE ss.shopId = ?`,
        [shopId],
      ),
    ]);
    return {
      shop: shopRows[0] ?? null,
      overrides: overrideRows,
      plan: new Map(planRows.map((r) => [r.featureKey, Boolean(r.entitled)])),
    };
  }

  private static statuses(
    shop: RowDataPacket,
    overrides: ShopfeatureoverrideRow[],
    plan: Map<string, boolean>,
  ): FeatureStatus[] {
    const byKey = new Map(overrides.map((o) => [o.featureKey, o]));
    return FEATURE_KEY_LIST.map((key) => {
      const def = defOf(key);
      const o = byKey.get(key);
      const columnValue =
        def.source === 'column' && shop[def.column] != null
          ? Boolean(shop[def.column])
          : null;
      const fromPlan = plan.get(key);
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
        entitled: fromPlan ?? true,
        entitledBy: fromPlan === undefined ? 'default' : 'plan',
        effective: resolveFlag(
          def,
          o ? Boolean(o.enabled) : undefined,
          columnValue,
          fromPlan,
        ),
      };
    });
  }

  // Every key for one shop in two queries. A shop that does not exist has every
  // feature off: unknown is never a plausible default.
  async getFlags(shopId: number, conn?: PoolConnection): Promise<FeatureFlags> {
    const { shop, overrides, plan } = await this.load(shopId, conn);
    const flags = {} as FeatureFlags;
    if (!shop) {
      for (const k of FEATURE_KEY_LIST) flags[k] = false;
      return flags;
    }
    for (const s of FeaturesService.statuses(shop, overrides, plan)) {
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
    const { shop, overrides, plan } = await this.load(shopId);
    return shop ? FeaturesService.statuses(shop, overrides, plan) : null;
  }

  // For the cron sweeps that used to filter on the column in SQL. Same
  // precedence as isEnabled, resolved in the query: the LEFT JOINs make a shop
  // with no subscription, or a plan with no row for the key, entitled (COALESCE
  // to 1), exactly like load(). Identifiers come from the registry constants,
  // never from input.
  async enabledShopIds(key: FeatureKey): Promise<number[]> {
    const def = defOf(key);
    const base =
      def.source === 'column' ? `s.\`${def.column}\`` : String(+def.default);
    const rows = await this.db.query<({ id: number } & RowDataPacket)[]>(
      `SELECT s.id FROM shop s
         LEFT JOIN shopfeatureoverride o ON o.shopId = s.id AND o.featureKey = ?
         LEFT JOIN shopsubscription ss ON ss.shopId = s.id
         LEFT JOIN planfeature pf ON pf.planId = ss.planId AND pf.featureKey = ?
        WHERE COALESCE(o.enabled, COALESCE(pf.entitled, 1) AND ${base}) = 1
        ORDER BY s.id`,
      [key, key],
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
