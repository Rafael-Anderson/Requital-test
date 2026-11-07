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
