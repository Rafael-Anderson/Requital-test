import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { ShopseosettingsRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { UpdateSeoDto } from './dto/update-seo.dto';

@Injectable()
export class SeoService {
  constructor(private readonly db: DatabaseService) {}

  async findOne(ctx: TenantContext) {
    const rows = await this.db.query<(ShopseosettingsRow & RowDataPacket)[]>(
      `SELECT * FROM shopseosettings WHERE shopId = ?`,
      [ctx.shopId],
    );
    // Same convention as ThemeService.findOne — no row yet is a valid,
    // common state (nothing saved), not an error.
    return (
      rows[0] ?? {
        shopId: ctx.shopId,
        metaTitle: null,
        metaDescription: null,
        ogImage: null,
        keywords: null,
      }
    );
  }

  async upsert(ctx: TenantContext, dto: UpdateSeoDto) {
    // Only the fields actually sent get touched on an existing row (matches
    // Prisma's `update: dto` partial semantics) — every field still gets a
    // real value (defaulting to null) on first insert. Falls back to a
    // trivial no-op update column when dto is genuinely empty, so the
    // ON DUPLICATE KEY UPDATE clause is never left with nothing to set.
    const updateColumns = Object.entries(dto)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    await upsert(
      this.db.pool,
      'shopseosettings',
      {
        shopId: ctx.shopId,
        metaTitle: dto.metaTitle ?? null,
        metaDescription: dto.metaDescription ?? null,
        ogImage: dto.ogImage ?? null,
        keywords: dto.keywords ?? null,
      },
      updateColumns.length > 0 ? updateColumns : ['shopId'],
    );
    return this.findOne(ctx);
  }
}
