import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { decrypt, encrypt } from '../common/crypto';
import type { TenantContext } from '../common/tenant-context';
import type { SetSliderCredentialsDto } from './dto/set-slider-credentials.dto';
import {
  SLIDER_BASE_URLS,
  type SliderEnvironment,
} from './slider/slider.constants';
import type { DeliveryProviderCredentials } from './slider/slider-delivery.interface';

interface StoredSliderCredentials {
  apiKey: string;
  accountId: string;
  webhookToken?: string;
  environment: SliderEnvironment;
}

export interface SliderSettingsResponse {
  hasCredentials: boolean;
  accountId: string | null;
  environment: SliderEnvironment | null;
  hasWebhookToken: boolean;
  // Never the real value — see maskValue.
  maskedApiKey: string | null;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '•'.repeat(Math.max(value.length, 4));
  return `••••${value.slice(-4)}`;
}

// Single shop-level encrypted slot (shop.sliderCredentials), same shape as
// WhatsAppSettingsService — one pluggable courier integration, not a
// per-provider table (see delivery-providers.module.ts / the interface's
// own ponytail note for why there's no registry yet).
@Injectable()
export class SliderSettingsService {
  constructor(private readonly db: DatabaseService) {}

  async find(ctx: TenantContext): Promise<SliderSettingsResponse> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT sliderCredentials FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Shop ${ctx.shopId} not found`);
    }
    return this.toResponse(rows[0].sliderCredentials as string | null);
  }

  async setCredentials(
    ctx: TenantContext,
    dto: SetSliderCredentialsDto,
  ): Promise<SliderSettingsResponse> {
    const existing = await this.readStored(ctx.shopId);
    const apiKey = dto.apiKey ?? existing?.apiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'apiKey is required the first time Slider credentials are saved',
      );
    }
    const encrypted = encrypt(
      JSON.stringify({
        apiKey,
        accountId: dto.accountId,
        webhookToken: dto.webhookToken ?? existing?.webhookToken,
        environment: dto.environment,
      } satisfies StoredSliderCredentials),
    );
    await this.db.execute(
      `UPDATE shop SET sliderCredentials = ? WHERE id = ?`,
      [encrypted, ctx.shopId],
    );
    return this.find(ctx);
  }

  async clearCredentials(ctx: TenantContext): Promise<SliderSettingsResponse> {
    await this.db.execute(
      `UPDATE shop SET sliderCredentials = NULL WHERE id = ?`,
      [ctx.shopId],
    );
    return this.find(ctx);
  }

  // Decrypted + shaped for a real provider call (baseUrl resolved from
  // environment). Null means "not configured" — callers throw
  // DeliveryProviderNotConfiguredException, there's no platform-level
  // fallback for this integration (unlike Payments/WhatsApp, Slider has no
  // env-var default — every shop brings its own sandbox/production keys).
  async resolveCredentials(
    shopId: number,
  ): Promise<DeliveryProviderCredentials | null> {
    const decoded = await this.readStored(shopId);
    if (!decoded) return null;
    return {
      apiKey: decoded.apiKey,
      accountId: decoded.accountId,
      baseUrl: SLIDER_BASE_URLS[decoded.environment],
    };
  }

  // For the webhook receiver's optional token check — same underlying read
  // as resolveCredentials, just narrowed to the one field a webhook needs.
  async resolveWebhookToken(shopId: number): Promise<string | null> {
    const decoded = await this.readStored(shopId);
    return decoded?.webhookToken ?? null;
  }

  private async readStored(
    shopId: number,
  ): Promise<StoredSliderCredentials | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT sliderCredentials FROM shop WHERE id = ?`,
      [shopId],
    );
    const stored = rows[0]?.sliderCredentials as string | null | undefined;
    if (!stored) return null;
    return JSON.parse(decrypt(stored)) as StoredSliderCredentials;
  }

  private toResponse(encrypted: string | null): SliderSettingsResponse {
    if (!encrypted) {
      return {
        hasCredentials: false,
        accountId: null,
        environment: null,
        hasWebhookToken: false,
        maskedApiKey: null,
      };
    }
    const decoded = JSON.parse(decrypt(encrypted)) as StoredSliderCredentials;
    return {
      hasCredentials: true,
      accountId: decoded.accountId,
      environment: decoded.environment,
      hasWebhookToken: !!decoded.webhookToken,
      maskedApiKey: maskValue(decoded.apiKey),
    };
  }
}
