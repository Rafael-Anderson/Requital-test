import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { decrypt, encrypt } from '../common/crypto';
import type { TenantContext } from '../common/tenant-context';
import { WHATSAPP_CREDENTIAL_FIELDS } from './whatsapp-credential-fields';
import type { SetWhatsAppCredentialsDto } from './dto/set-whatsapp-credentials.dto';

export interface WhatsAppSettingsResponse {
  hasCredentials: boolean;
  // Never the real value — e.g. { accessToken: '••••1234' }. See maskValue.
  maskedCredentials: Record<string, string> | null;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '•'.repeat(Math.max(value.length, 4));
  return `••••${value.slice(-4)}`;
}

// Single shop-level encrypted slot (shop.whatsappCredentials), not a
// shoppaymentprovider-style per-provider table — see the schema field's own
// doc comment for why (one pluggable implementation, not a merchant choice
// among several).
@Injectable()
export class WhatsAppSettingsService {
  constructor(private readonly db: DatabaseService) {}

  async find(ctx: TenantContext): Promise<WhatsAppSettingsResponse> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT whatsappCredentials FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Shop ${ctx.shopId} not found`);
    }
    return this.toResponse(rows[0].whatsappCredentials as string | null);
  }

  async setCredentials(
    ctx: TenantContext,
    dto: SetWhatsAppCredentialsDto,
  ): Promise<WhatsAppSettingsResponse> {
    const encrypted = encrypt(
      JSON.stringify({
        phoneNumberId: dto.phoneNumberId,
        accessToken: dto.accessToken,
      }),
    );
    await this.db.execute(`UPDATE shop SET whatsappCredentials = ? WHERE id = ?`, [
      encrypted,
      ctx.shopId,
    ]);
    return this.find(ctx);
  }

  async clearCredentials(
    ctx: TenantContext,
  ): Promise<WhatsAppSettingsResponse> {
    await this.db.execute(`UPDATE shop SET whatsappCredentials = NULL WHERE id = ?`, [
      ctx.shopId,
    ]);
    return this.find(ctx);
  }

  // Decrypted server-side only, to hand a real provider call what it needs
  // (OrderNotificationsService) — never returned to any client. Null means
  // "not configured", the caller's signal to fall back to sendWhatsAppStub.
  async resolveCredentials(
    shopId: number,
  ): Promise<Record<string, string> | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT whatsappCredentials FROM shop WHERE id = ?`,
      [shopId],
    );
    const whatsappCredentials = rows[0]?.whatsappCredentials as
      | string
      | null
      | undefined;
    if (!whatsappCredentials) return null;
    return JSON.parse(decrypt(whatsappCredentials)) as Record<string, string>;
  }

  private toResponse(encrypted: string | null): WhatsAppSettingsResponse {
    if (!encrypted) return { hasCredentials: false, maskedCredentials: null };
    const decrypted = JSON.parse(decrypt(encrypted)) as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const field of WHATSAPP_CREDENTIAL_FIELDS) {
      if (decrypted[field.key])
        masked[field.key] = maskValue(decrypted[field.key]);
    }
    return { hasCredentials: true, maskedCredentials: masked };
  }
}
