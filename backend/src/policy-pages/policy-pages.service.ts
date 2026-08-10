import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { PolicypageRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import {
  POLICY_PAGE_TYPES,
  type PolicyPageType,
} from './policy-page-constants';
import { UpsertPolicyPageDto } from './dto/upsert-policy-page.dto';

@Injectable()
export class PolicyPagesService {
  constructor(private readonly db: DatabaseService) {}

  // All 5 types, always — a type with no saved row comes back as
  // `content: null` rather than being omitted, so the admin UI can render a
  // consistent 5-row list (written vs. not written) instead of a variable-
  // length one.
  async findAll(ctx: TenantContext) {
    const rows = await this.db.query<(PolicypageRow & RowDataPacket)[]>(
      `SELECT * FROM policypage WHERE shopId = ?`,
      [ctx.shopId],
    );
    const byType = new Map(rows.map((r) => [r.type, r]));
    return POLICY_PAGE_TYPES.map((type) => {
      const row = byType.get(type);
      return {
        type,
        content: row?.content ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async upsert(ctx: TenantContext, type: PolicyPageType, dto: UpsertPolicyPageDto) {
    // updatedAt has no DB-level default-on-update — Prisma's @updatedAt
    // was an application-level behavior, so it's set explicitly here now.
    await upsert(
      this.db.pool,
      'policypage',
      { shopId: ctx.shopId, type, content: dto.content, updatedAt: new Date() },
      ['content', 'updatedAt'],
    );
    return this.findByShopAndType(ctx.shopId, type);
  }

  // Public — no auth, resolved by shopId (already tenant-scoped by the
  // caller, see PublicService.getPolicyPage) rather than trusting a
  // client-supplied shopId directly.
  async findPublic(shopId: number, type: PolicyPageType) {
    const row = await this.findByShopAndType(shopId, type);
    // 404, not a null/empty body — a policy type with no content isn't a
    // real page (see Footer.tsx, which never links to one in that state),
    // so reaching this URL directly should read as "not found," not "found
    // but blank."
    if (!row) {
      throw new NotFoundException(
        `No ${type} policy page has been published for this shop`,
      );
    }
    return row;
  }

  private async findByShopAndType(shopId: number, type: PolicyPageType) {
    const rows = await this.db.query<(PolicypageRow & RowDataPacket)[]>(
      `SELECT * FROM policypage WHERE shopId = ? AND type = ?`,
      [shopId, type],
    );
    return rows[0];
  }
}
