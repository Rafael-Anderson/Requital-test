import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  async find(ctx: TenantContext): Promise<WhatsAppSettingsResponse> {
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: ctx.shopId },
      select: { whatsappCredentials: true },
    });
    return this.toResponse(shop.whatsappCredentials);
  }

  async setCredentials(
    ctx: TenantContext,
    dto: SetWhatsAppCredentialsDto,
  ): Promise<WhatsAppSettingsResponse> {
    const encrypted = encrypt(
      JSON.stringify({ phoneNumberId: dto.phoneNumberId, accessToken: dto.accessToken }),
    );
    await this.prisma.shop.update({
      where: { id: ctx.shopId },
      data: { whatsappCredentials: encrypted },
    });
    return this.find(ctx);
  }

  async clearCredentials(ctx: TenantContext): Promise<WhatsAppSettingsResponse> {
    await this.prisma.shop.update({
      where: { id: ctx.shopId },
      data: { whatsappCredentials: null },
    });
    return this.find(ctx);
  }

  // Decrypted server-side only, to hand a real provider call what it needs
  // (OrderNotificationsService) — never returned to any client. Null means
  // "not configured", the caller's signal to fall back to sendWhatsAppStub.
  async resolveCredentials(shopId: number): Promise<Record<string, string> | null> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { whatsappCredentials: true },
    });
    if (!shop?.whatsappCredentials) return null;
    return JSON.parse(decrypt(shop.whatsappCredentials)) as Record<string, string>;
  }

  private toResponse(encrypted: string | null): WhatsAppSettingsResponse {
    if (!encrypted) return { hasCredentials: false, maskedCredentials: null };
    const decrypted = JSON.parse(decrypt(encrypted)) as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const field of WHATSAPP_CREDENTIAL_FIELDS) {
      if (decrypted[field.key]) masked[field.key] = maskValue(decrypted[field.key]);
    }
    return { hasCredentials: true, maskedCredentials: masked };
  }
}
