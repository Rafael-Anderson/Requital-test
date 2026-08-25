import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { createLogger } from '../common/logging/logger';
import {
  SLIDER_BASE_URLS,
  type SliderEnvironment,
} from './slider/slider.constants';
import type { DeliveryProviderCredentials } from './slider/slider-delivery.interface';

const logger = createLogger('SliderSettingsService');

export type SliderStatus = 'connected' | 'awaiting_setup' | 'not_enabled';

export interface SliderSettingsResponse {
  enabled: boolean;
  accountId: string | null;
  status: SliderStatus;
}

// Slider is a platform partnership, not a bring-your-own-keys integration
// like Payments/WhatsApp — Requital holds ONE API key for every merchant
// (SLIDER_API_KEY/SLIDER_ENVIRONMENT/SLIDER_WEBHOOK_TOKEN, env vars, never
// touched by this service), and each shop is a customer account under that
// partner, identified by sliderAccountId. Nothing here encrypts or decrypts
// anything — sliderAccountId isn't a secret (it's an identifier, not a
// credential), so it's a plain column, not an encrypted blob like
// shop.whatsappCredentials. See CLAUDE.md for the full model and the
// PR #72 correction this replaces.
@Injectable()
export class SliderSettingsService {
  constructor(private readonly db: DatabaseService) {}

  // Merchant-facing read — used by both the Integrations > Delivery card
  // (status indicator) and SliderDeliveryPanel (to decide whether to offer
  // dispatch at all, rather than letting a request fail at call time).
  async find(ctx: TenantContext): Promise<SliderSettingsResponse> {
    const row = await this.findRow(ctx.shopId);
    return this.toResponse(row);
  }

  // Merchant-facing write — the only thing a shop admin can change. Setting
  // sliderAccountId is platform-admin only (see setAccountId below).
  async setEnabled(
    ctx: TenantContext,
    enabled: boolean,
  ): Promise<SliderSettingsResponse> {
    await this.db.execute(`UPDATE shop SET sliderEnabled = ? WHERE id = ?`, [
      enabled,
      ctx.shopId,
    ]);
    return this.find(ctx);
  }

  // Platform-admin only (see platform-admin/platform-admin.controller.ts) —
  // a merchant has no Slider dashboard access to get this value themselves.
  async setAccountId(
    shopId: number,
    accountId: string,
  ): Promise<SliderSettingsResponse> {
    const result = await this.db.execute(
      `UPDATE shop SET sliderAccountId = ? WHERE id = ?`,
      [accountId, shopId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException(`Shop ${shopId} not found`);
    }
    const row = await this.findRow(shopId);
    return this.toResponse(row);
  }

  // Resolved for a real provider call — null means "don't offer Slider for
  // this shop right now," covering all three ways that can be true: the
  // shop hasn't enabled it, Slider hasn't finished setting up their account
  // id yet (see the "awaiting setup" status), or (a platform misconfiguration,
  // logged as a warning rather than thrown — this is Requital's own fault,
  // not something a merchant-facing 400 should describe) the platform env
  // vars themselves aren't set.
  async resolveCredentials(
    shopId: number,
  ): Promise<DeliveryProviderCredentials | null> {
    const row = await this.findRow(shopId);
    if (!row || !row.sliderEnabled || !row.sliderAccountId) return null;

    const apiKey = process.env.SLIDER_API_KEY;
    const environment = process.env.SLIDER_ENVIRONMENT as
      SliderEnvironment | undefined;
    if (!apiKey || !environment || !(environment in SLIDER_BASE_URLS)) {
      logger.warn(
        'Slider platform credentials are not configured (SLIDER_API_KEY/SLIDER_ENVIRONMENT env vars)',
      );
      return null;
    }
    return {
      apiKey,
      accountId: row.sliderAccountId,
      baseUrl: SLIDER_BASE_URLS[environment],
    };
  }

  private async findRow(shopId: number): Promise<{
    sliderEnabled: boolean;
    sliderAccountId: string | null;
  } | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT sliderEnabled, sliderAccountId FROM shop WHERE id = ?`,
      [shopId],
    );
    if (rows.length === 0) return null;
    return {
      sliderEnabled: !!rows[0].sliderEnabled,
      sliderAccountId: rows[0].sliderAccountId as string | null,
    };
  }

  private toResponse(
    row: { sliderEnabled: boolean; sliderAccountId: string | null } | null,
  ): SliderSettingsResponse {
    if (!row) {
      throw new NotFoundException('Shop not found');
    }
    const status: SliderStatus = !row.sliderEnabled
      ? 'not_enabled'
      : row.sliderAccountId
        ? 'connected'
        : 'awaiting_setup';
    return {
      enabled: row.sliderEnabled,
      accountId: row.sliderAccountId,
      status,
    };
  }
}
