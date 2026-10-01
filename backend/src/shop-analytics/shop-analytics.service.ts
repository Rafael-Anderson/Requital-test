import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { decrypt, encrypt } from '../common/crypto';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { ShopanalyticsRow } from '../db/types';
import type { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

// What the admin page gets. The Meta access token is deliberately NOT here, in
// any form (not masked, not a suffix): only whether one is set.
export interface AnalyticsSettingsResponse {
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  metaCapiTokenSet: boolean;
  metaTestEventCode: string | null;
  tiktokPixelId: string | null;
  snapPixelId: string | null;
  googleAdsConversionId: string | null;
  googleAdsConversionLabel: string | null;
}

// What the storefront gets: public identifiers only, and only the ones that are
// configured (an absent key means "not configured"). `null` when nothing is.
// metaTestEventCode is server-only and is never here.
export interface PublicAnalyticsConfig {
  ga4MeasurementId?: string;
  metaPixelId?: string;
  tiktokPixelId?: string;
  snapPixelId?: string;
  googleAdsConversionId?: string;
  googleAdsConversionLabel?: string;
}

export interface MetaCapiCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
}

// The only columns an update may touch, as a closed map from the DTO key to the
// real column. A DTO key is never interpolated into SQL.
const PLAIN_FIELDS = [
  'ga4MeasurementId',
  'metaPixelId',
  'metaTestEventCode',
  'tiktokPixelId',
  'snapPixelId',
  'googleAdsConversionId',
  'googleAdsConversionLabel',
] as const;

@Injectable()
export class ShopAnalyticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async loadRow(shopId: number): Promise<ShopanalyticsRow | null> {
    const rows = await this.db.query<(ShopanalyticsRow & RowDataPacket)[]>(
      `SELECT * FROM shopanalytics WHERE shopId = ?`,
      [shopId],
    );
    return rows[0] ?? null;
  }

  private toSettings(row: ShopanalyticsRow | null): AnalyticsSettingsResponse {
    return {
      ga4MeasurementId: row?.ga4MeasurementId ?? null,
      metaPixelId: row?.metaPixelId ?? null,
      metaCapiTokenSet: Boolean(row?.metaCapiTokenEnc),
      metaTestEventCode: row?.metaTestEventCode ?? null,
      tiktokPixelId: row?.tiktokPixelId ?? null,
      snapPixelId: row?.snapPixelId ?? null,
      googleAdsConversionId: row?.googleAdsConversionId ?? null,
      googleAdsConversionLabel: row?.googleAdsConversionLabel ?? null,
    };
  }

  async find(ctx: TenantContext): Promise<AnalyticsSettingsResponse> {
    return this.toSettings(await this.loadRow(ctx.shopId));
  }

  async update(
    ctx: TenantContext,
    dto: UpdateAnalyticsSettingsDto,
  ): Promise<AnalyticsSettingsResponse> {
    const columns: string[] = [];
    const values: QueryParam[] = [];
    const changed: string[] = [];

    for (const field of PLAIN_FIELDS) {
      if (dto[field] === undefined) continue;
      columns.push(field);
      values.push(dto[field]);
      changed.push(field);
    }
    if (dto.metaCapiToken !== undefined) {
      columns.push('metaCapiTokenEnc');
      values.push(dto.metaCapiToken === null ? null : encrypt(dto.metaCapiToken));
      // The name of the field that changed, never its value.
      changed.push('metaCapiToken');
    }

    if (columns.length > 0) {
      // Upsert: the row is created lazily by the first save, and two concurrent
      // first saves cannot both INSERT (UNIQUE shopId), so the loser updates.
      await this.db.execute(
        `INSERT INTO shopanalytics (shopId, updatedAt, ${columns.join(', ')})
         VALUES (?, ?, ${columns.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE updatedAt = VALUES(updatedAt),
           ${columns.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
        [ctx.shopId, new Date(), ...values],
      );
      await this.auditLogService.logCtx(ctx, {
        action: 'analytics_settings.updated',
        entityType: 'shop',
        entityId: ctx.shopId,
        // Field names only. The values are public ids (not secret) but the
        // token must never be written to a log row, so the rule is uniform.
        metadata: { fields: changed },
      });
    }
    return this.find(ctx);
  }

  // Public-safe config for the storefront. Re-validated by the storefront before
  // use; absent keys mean "not configured".
  async resolvePublicConfig(shopId: number): Promise<PublicAnalyticsConfig | null> {
    const row = await this.loadRow(shopId);
    if (!row) return null;
    const config: PublicAnalyticsConfig = {};
    if (row.ga4MeasurementId) config.ga4MeasurementId = row.ga4MeasurementId;
    if (row.metaPixelId) config.metaPixelId = row.metaPixelId;
    if (row.tiktokPixelId) config.tiktokPixelId = row.tiktokPixelId;
    if (row.snapPixelId) config.snapPixelId = row.snapPixelId;
    if (row.googleAdsConversionId) {
      config.googleAdsConversionId = row.googleAdsConversionId;
      if (row.googleAdsConversionLabel) {
        config.googleAdsConversionLabel = row.googleAdsConversionLabel;
      }
    }
    return Object.keys(config).length > 0 ? config : null;
  }

  // Server-side only. Null unless BOTH the pixel id and a token are set: a pixel
  // with no token is a browser-only setup and there is nothing to send.
  async resolveMetaCapiCredentials(
    shopId: number,
  ): Promise<MetaCapiCredentials | null> {
    const row = await this.loadRow(shopId);
    if (!row?.metaPixelId || !row.metaCapiTokenEnc) return null;
    return {
      pixelId: row.metaPixelId,
      accessToken: decrypt(row.metaCapiTokenEnc),
      testEventCode: row.metaTestEventCode ?? null,
    };
  }
}
