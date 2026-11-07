import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import type { CollectionruleRow } from '../db/types';
import {
  buildCollectionPredicate,
  MAX_RULES,
  normalizeRule,
  type MatchMode,
  type ParsedRule,
} from './collection-rules';

export interface RuleInput {
  field: string;
  operator: string;
  value?: string | null;
}

// Upper bound for one storefront collection page of an automated collection.
const PUBLIC_PRODUCT_CAP = 1000;

@Injectable()
export class CollectionRulesService {
  constructor(private readonly db: DatabaseService) {}

  // Allowlist validation plus the one tenant check a DTO cannot do: a Category
  // condition must point at a MANUAL collection of this shop. Runs before any
  // transaction (it uses the pool).
  async validate(shopId: number, raw: RuleInput[]): Promise<ParsedRule[]> {
    if (raw.length > MAX_RULES) {
      throw new BadRequestException(`At most ${MAX_RULES} conditions are allowed`);
    }
    const rules: ParsedRule[] = [];
    for (const r of raw) {
      try {
        rules.push(normalizeRule(r));
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    const categoryIds = [
      ...new Set(
        rules.filter((r) => r.field === 'category').map((r) => Number(r.value)),
      ),
    ];
    if (categoryIds.length > 0) {
      const found = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM collection WHERE shopId = ? AND collectionType = 'manual' AND id IN (${categoryIds.map(() => '?').join(', ')})`,
        [shopId, ...categoryIds],
      );
      if (found.length !== categoryIds.length) {
        throw new BadRequestException(
          'A Category condition must use a manual collection of this shop',
        );
      }
    }
    return rules;
  }

  async load(shopId: number, collectionId: number): Promise<ParsedRule[]> {
    const rows = await this.db.query<(CollectionruleRow & RowDataPacket)[]>(
      `SELECT field, operator, value FROM collectionrule WHERE shopId = ? AND collectionId = ? ORDER BY position ASC, id ASC`,
      [shopId, collectionId],
    );
    return rows.map((r) => ({
      field: r.field as ParsedRule['field'],
      operator: r.operator,
      value: r.value,
    }));
  }

  // Full replace, on the caller's transaction connection.
  async replace(
    conn: PoolConnection,
    shopId: number,
    collectionId: number,
    rules: ParsedRule[],
  ) {
    await conn.query(
      `DELETE FROM collectionrule WHERE shopId = ? AND collectionId = ?`,
      [shopId, collectionId],
    );
    for (let i = 0; i < rules.length; i++) {
      await conn.query(
        `INSERT INTO collectionrule (shopId, collectionId, field, operator, value, position) VALUES (?, ?, ?, ?, ?, ?)`,
        [shopId, collectionId, rules[i].field, rules[i].operator, rules[i].value, i],
      );
    }
  }

  private where(
    shopId: number,
    matchMode: MatchMode,
    rules: ParsedRule[],
    availableOnly: boolean,
  ) {
    const pred = buildCollectionPredicate(matchMode, rules);
    return {
      sql: `p.shopId = ?${availableOnly ? " AND p.status = 'Available'" : ''} AND ${pred.sql}`,
      params: [shopId, ...pred.params] as QueryParam[],
    };
  }

  async preview(
    shopId: number,
    matchMode: MatchMode,
    rules: ParsedRule[],
    page: number,
    pageSize: number,
  ) {
    const w = this.where(shopId, matchMode, rules, false);
    const [countRows, data] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM product p WHERE ${w.sql}`,
        w.params,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT p.id, p.name, p.thumbnail, p.status, p.price FROM product p WHERE ${w.sql} ORDER BY p.id ASC LIMIT ? OFFSET ?`,
        [...w.params, pageSize, (page - 1) * pageSize],
      ),
    ]);
    return {
      total: Number(countRows[0].c),
      page,
      pageSize,
      data: data.map((r) => ({
        id: r.id as number,
        name: r.name as string,
        thumbnail: r.thumbnail as string,
        status: r.status as string,
        price: r.price as string,
      })),
    };
  }

  // "Is product p a member of this collection?" as a WHERE fragment over the alias `p`
  // (product), for every reader that used to join productcollection directly: a manual
  // collection is its hand-picked links, an automated one is its conditions, built by
  // the same buildCollectionPredicate the storefront page uses. Shop-scoped (an id of
  // another shop, or a missing one, matches nothing); the caller still scopes `p`.
  async memberPredicate(
    shopId: number,
    collectionId: number,
  ): Promise<{ sql: string; params: QueryParam[] }> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, collectionType, matchMode FROM collection WHERE id = ? AND shopId = ?`,
      [collectionId, shopId],
    );
    const c = rows[0];
    if (!c) return { sql: '1 = 0', params: [] };
    if (c.collectionType === 'automated') {
      return buildCollectionPredicate(
        c.matchMode as MatchMode,
        await this.load(shopId, collectionId),
      );
    }
    return {
      sql: 'EXISTS (SELECT 1 FROM productcollection pc WHERE pc.productId = p.id AND pc.collectionId = ?)',
      params: [collectionId],
    };
  }

  // Available products of one collection (manual or automated), shop-scoped, in id order.
  async availableMemberIds(
    shopId: number,
    collectionId: number,
  ): Promise<number[]> {
    const pred = await this.memberPredicate(shopId, collectionId);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id FROM product p
        WHERE p.shopId = ? AND p.status = 'Available' AND ${pred.sql}
        ORDER BY p.id ASC LIMIT ${PUBLIC_PRODUCT_CAP}`,
      [shopId, ...pred.params],
    );
    return rows.map((r) => r.id as number);
  }

  // productId -> the AUTOMATED collections it currently belongs to, for the given
  // products only (discount scoping, auto-discounts). One query per batch of
  // collections (UNION ALL), every value a bound parameter, every product scoped to
  // the shop. Manual links are NOT included: callers already read productcollection.
  async automatedCollectionIdsByProduct(
    shopId: number,
    productIds: number[],
  ): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (productIds.length === 0) return result;
    const collections = await this.db.query<RowDataPacket[]>(
      `SELECT id, matchMode FROM collection WHERE shopId = ? AND collectionType = 'automated' ORDER BY id ASC`,
      [shopId],
    );
    if (collections.length === 0) return result;
    const ruleRows = await this.db.query<(CollectionruleRow & RowDataPacket)[]>(
      `SELECT collectionId, field, operator, value FROM collectionrule
        WHERE shopId = ? ORDER BY collectionId ASC, position ASC, id ASC`,
      [shopId],
    );
    const rulesBy = new Map<number, ParsedRule[]>();
    for (const r of ruleRows) {
      const list = rulesBy.get(r.collectionId) ?? [];
      list.push({
        field: r.field as ParsedRule['field'],
        operator: r.operator,
        value: r.value,
      });
      rulesBy.set(r.collectionId, list);
    }
    const idList = productIds.map(() => '?').join(', ');
    const selects: { sql: string; params: QueryParam[] }[] = [];
    for (const c of collections) {
      const rules = rulesBy.get(c.id as number) ?? [];
      if (rules.length === 0) continue; // no conditions matches nothing
      const pred = buildCollectionPredicate(c.matchMode as MatchMode, rules);
      selects.push({
        sql: `SELECT p.id AS productId, ${Number(c.id)} AS collectionId FROM product p WHERE p.shopId = ? AND p.id IN (${idList}) AND ${pred.sql}`,
        params: [shopId, ...productIds, ...pred.params],
      });
    }
    const BATCH = 10;
    for (let i = 0; i < selects.length; i += BATCH) {
      const batch = selects.slice(i, i + BATCH);
      const rows = await this.db.query<RowDataPacket[]>(
        batch.map((b) => b.sql).join(' UNION ALL '),
        batch.flatMap((b) => b.params),
      );
      for (const r of rows) {
        const list = result.get(r.productId as number) ?? [];
        list.push(r.collectionId as number);
        result.set(r.productId as number, list);
      }
    }
    return result;
  }

  // Storefront: only Available products, capped.
  async availableProductIds(
    shopId: number,
    collectionId: number,
    matchMode: MatchMode,
  ): Promise<number[]> {
    const rules = await this.load(shopId, collectionId);
    const w = this.where(shopId, matchMode, rules, true);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id FROM product p WHERE ${w.sql} ORDER BY p.id ASC LIMIT ${PUBLIC_PRODUCT_CAP}`,
      w.params,
    );
    return rows.map((r) => r.id as number);
  }
}
