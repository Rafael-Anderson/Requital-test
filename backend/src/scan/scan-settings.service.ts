import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { UpdateScanSettingsDto } from './dto/update-scan-settings.dto';
import { DEFAULT_EXCLUDE_KEYWORDS } from './ocr-parser';

export interface ScanSettingsResponse {
  shopId: number;
  excludeKeywords: string[];
  includeKeywords: string[];
  defaultOutletId: number | null;
  unmatchedBehavior: 'ask' | 'create';
}

// Same upsert-by-shopId, defaults-when-no-row-yet convention as
// SeoService/ThemeService — see seo.service.ts.
@Injectable()
export class ScanSettingsService {
  constructor(private readonly db: DatabaseService) {}

  async findOne(ctx: TenantContext): Promise<ScanSettingsResponse> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM scansettings WHERE shopId = ?`,
      [ctx.shopId],
    );
    const settings = rows[0];
    if (!settings) {
      return {
        shopId: ctx.shopId,
        excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
        includeKeywords: [],
        defaultOutletId: null,
        unmatchedBehavior: 'ask',
      };
    }
    return {
      shopId: settings.shopId as number,
      excludeKeywords: settings.excludeKeywords as string[],
      includeKeywords: settings.includeKeywords as string[],
      defaultOutletId: settings.defaultOutletId as number | null,
      unmatchedBehavior: settings.unmatchedBehavior as 'ask' | 'create',
    };
  }

  async upsert(
    ctx: TenantContext,
    dto: UpdateScanSettingsDto,
  ): Promise<ScanSettingsResponse> {
    if (dto.defaultOutletId) {
      const outletRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [dto.defaultOutletId, ctx.shopId],
      );
      if (outletRows.length === 0) {
        throw new BadRequestException(
          'defaultOutletId is invalid for this shop',
        );
      }
    }

    const updateColumns: string[] = [];
    if (dto.excludeKeywords !== undefined) updateColumns.push('excludeKeywords');
    if (dto.includeKeywords !== undefined) updateColumns.push('includeKeywords');
    if (dto.defaultOutletId !== undefined) updateColumns.push('defaultOutletId');
    if (dto.unmatchedBehavior !== undefined) updateColumns.push('unmatchedBehavior');
    updateColumns.push('updatedAt');

    await upsert(
      this.db.pool,
      'scansettings',
      {
        shopId: ctx.shopId,
        excludeKeywords: JSON.stringify(dto.excludeKeywords ?? DEFAULT_EXCLUDE_KEYWORDS),
        includeKeywords: JSON.stringify(dto.includeKeywords ?? []),
        defaultOutletId: dto.defaultOutletId ?? null,
        unmatchedBehavior: dto.unmatchedBehavior ?? 'ask',
        updatedAt: new Date(),
      },
      updateColumns,
    );

    return this.findOne(ctx);
  }
}
