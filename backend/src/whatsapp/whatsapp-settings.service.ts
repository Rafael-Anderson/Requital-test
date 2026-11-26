import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { decrypt, encrypt } from '../common/crypto';
import type { TenantContext } from '../common/tenant-context';
import { normalizePhoneToE164 } from '../common/phone';
import { MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';
import { WHATSAPP_CREDENTIAL_FIELDS } from './whatsapp-credential-fields';
import type { SetWhatsAppCredentialsDto } from './dto/set-whatsapp-credentials.dto';
import {
  sanitizeCredentialMap,
  sanitizeCredentialValue,
} from '../common/credential-sanitize';
import { whatsappCredentialProblems } from './whatsapp-credential-validation';
import { MetaGraphError, type MetaErrorDetails } from './meta-graph-error';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('WhatsAppSettingsService');

// The automatic Test connection after a save calls Meta. Under Jest it is off
// unless a spec opts in (WHATSAPP_AUTOTEST_IN_TESTS=1), so no spec reaches the
// real Graph API by saving credentials (same seam as payment settings).
function autoTestOnSave(): boolean {
  return (
    process.env.NODE_ENV !== 'test' ||
    process.env.WHATSAPP_AUTOTEST_IN_TESTS === '1'
  );
}

// What "Test connection" answers. Never a token or a credential value.
export type WhatsAppConnectionTest =
  | {
      ok: true;
      displayPhoneNumber: string | null;
      verifiedName: string | null;
    }
  | {
      ok: false;
      // 'network' = Meta could not be reached (nothing is known either way).
      reason: string;
      message: string;
      details: MetaErrorDetails | null;
    };

export interface WhatsAppSettingsResponse {
  hasCredentials: boolean;
  // Present only on the answer to a save: the automatic Test connection.
  connectionTest?: WhatsAppConnectionTest;
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
  constructor(
    private readonly db: DatabaseService,
    private readonly metaWhatsAppProvider: MetaWhatsAppProvider,
  ) {}

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
    // The DTO already removed pasted invisible characters; done again here so
    // no caller can store an unclean value.
    const phoneNumberId = sanitizeCredentialValue(dto.phoneNumberId);
    const accessToken = sanitizeCredentialValue(dto.accessToken);
    const problems = whatsappCredentialProblems({ phoneNumberId, accessToken });
    if (Object.keys(problems).length > 0) {
      // `message` is the first problem (what apiFetch shows); `fieldErrors` lets
      // the form put each one under its own field.
      throw new BadRequestException({
        statusCode: 400,
        message: Object.values(problems)[0],
        fieldErrors: problems,
      });
    }
    const encrypted = encrypt(JSON.stringify({ phoneNumberId, accessToken }));
    await this.db.execute(
      `UPDATE shop SET whatsappCredentials = ? WHERE id = ?`,
      [encrypted, ctx.shopId],
    );
    // Test connection runs on every save. Saving is never blocked by it: a
    // failure (or Meta being unreachable) is reported beside the saved result.
    if (!autoTestOnSave()) return this.find(ctx);
    const connectionTest = await this.testConnection(ctx);
    return { ...(await this.find(ctx)), connectionTest };
  }

  async clearCredentials(
    ctx: TenantContext,
  ): Promise<WhatsAppSettingsResponse> {
    await this.db.execute(
      `UPDATE shop SET whatsappCredentials = NULL WHERE id = ?`,
      [ctx.shopId],
    );
    return this.find(ctx);
  }

  // Lets a merchant verify their own saved credentials actually work,
  // without waiting for a real order — sends through the same
  // MetaWhatsAppProvider OrderNotificationsService uses, against this
  // shop's own resolved credentials (never the platform fallback; there
  // isn't one for WhatsApp Business API — see resolveCredentials below).
  async sendTestMessage(
    ctx: TenantContext,
    phoneNumber: string,
  ): Promise<{ sent: true }> {
    const credentials = await this.resolveCredentials(ctx.shopId);
    if (!credentials) {
      throw new BadRequestException(
        'Save your WhatsApp Business API credentials before sending a test message',
      );
    }
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT countryCode FROM shop WHERE id = ?`,
      [ctx.shopId],
    );
    const to = normalizePhoneToE164(
      phoneNumber,
      shopRows[0]?.countryCode as string | null | undefined,
    );
    if (!to) {
      throw new BadRequestException('Enter a valid phone number');
    }
    try {
      await this.metaWhatsAppProvider.sendMessage({
        to,
        body: 'This is a test message from your Requital store: WhatsApp Business API is connected correctly.',
        credentials,
      });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        // A friendly sentence plus Meta's own message and fbtrace_id, never the
        // raw response body (and never the token).
        throw new BadRequestException({
          statusCode: 400,
          message: err.friendly.message,
          reason: err.friendly.reason,
          details: err.friendly.details,
        });
      }
      throw err;
    }
    return { sent: true };
  }

  // A harmless GET of the phone number's own record on the Graph API (sends no
  // message). Never throws for a Meta or network failure: the answer says what
  // happened.
  async testConnection(ctx: TenantContext): Promise<WhatsAppConnectionTest> {
    const credentials = await this.resolveCredentials(ctx.shopId);
    if (!credentials) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'Save your WhatsApp Business API credentials first.',
        details: null,
      };
    }
    try {
      const info =
        await this.metaWhatsAppProvider.describePhoneNumber(credentials);
      return { ok: true, ...info };
    } catch (err) {
      if (err instanceof MetaGraphError) {
        return {
          ok: false,
          reason: err.friendly.reason,
          message: err.friendly.message,
          details: err.friendly.details,
        };
      }
      logger.warn('whatsapp test connection could not reach Meta', {
        shopId: ctx.shopId,
        error: err instanceof Error ? err.name : 'non-error',
      });
      return {
        ok: false,
        reason: 'network',
        message:
          'Could not reach Meta to check the connection. Your credentials are saved; try Test connection again in a moment.',
        details: null,
      };
    }
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
      string | null | undefined;
    if (!whatsappCredentials) return null;
    // Sanitised on USE as well as on save, so a value stored before the
    // clean-up existed (with a pasted invisible character) works at once.
    return sanitizeCredentialMap(
      JSON.parse(decrypt(whatsappCredentials)) as Record<string, string>,
    );
  }

  private toResponse(encrypted: string | null): WhatsAppSettingsResponse {
    if (!encrypted) return { hasCredentials: false, maskedCredentials: null };
    const decrypted = sanitizeCredentialMap(
      JSON.parse(decrypt(encrypted)) as Record<string, string>,
    );
    const masked: Record<string, string> = {};
    for (const field of WHATSAPP_CREDENTIAL_FIELDS) {
      if (decrypted[field.key])
        masked[field.key] = maskValue(decrypted[field.key]);
    }
    return { hasCredentials: true, maskedCredentials: masked };
  }
}
