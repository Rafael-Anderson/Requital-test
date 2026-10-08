import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { AuthService } from '../auth/auth.service';
import { SliderSettingsService } from '../delivery-providers/slider-settings.service';
import { SliderDeliveryProvider } from '../delivery-providers/slider/slider-delivery.provider';
import { SLIDER_CURRENCY } from '../delivery-providers/slider/slider.constants';
import { assertShopCountryIsUae } from '../delivery-providers/slider/slider-caps';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { JobsService } from '../jobs/jobs.service';
import { MfaStore } from '../two-factor/mfa-store';
import { escapeHtml } from '../common/email';
import { FeaturesService } from '../features/features.service';
import { isFeatureKey } from '../features/feature-keys';
import type { ShopRow, OutletRow } from '../db/types';

export type ShopStatus = 'active' | 'suspended';

// Shops list/detail, suspend/unsuspend, impersonation, Slider test-dispatch,
// and platform-settings status — the platform admin app's core surface.
// Every mutation here logs to PlatformAuditLogService BEFORE returning (see
// that service's own comment on why a failed log write fails the action).
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
    private readonly sliderSettingsService: SliderSettingsService,
    private readonly sliderProvider: SliderDeliveryProvider,
    private readonly platformAuditLogService: PlatformAuditLogService,
    private readonly features: FeaturesService,
    private readonly jobs: JobsService,
  ) {
    this.staffMfa = new MfaStore(db, 'staff');
  }

  private readonly staffMfa: MfaStore;

  // Staff of one shop, for the "Staff two-factor" picker. Explicit columns only:
  // no password hash, no TOTP secret, no recovery code, no token ever leaves here.
  async listShopUsers(shopId: number) {
    const shops = await this.db.query<RowDataPacket[]>(
      `SELECT require2fa FROM shop WHERE id = ?`,
      [shopId],
    );
    if (!shops[0]) throw new NotFoundException('Shop not found');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.role, u.outletId, o.name AS outletName,
              u.mustEnrol2fa,
              EXISTS(SELECT 1 FROM usertotp t
                     WHERE t.userId = u.id AND t.confirmedAt IS NOT NULL) AS mfaEnrolled,
              (SELECT MAX(r.createdAt) FROM refreshtoken r WHERE r.userId = u.id) AS lastSignInAt
         FROM user u LEFT JOIN outlet o ON o.id = u.outletId AND o.shopId = u.shopId
        WHERE u.shopId = ?
        ORDER BY u.id`,
      [shopId],
    );
    return {
      shopRequires2fa: !!shops[0].require2fa,
      users: rows.map((u) => ({
        id: u.id as number,
        name: u.name as string,
        email: u.email as string,
        role: u.role as string,
        outletId: (u.outletId as number | null) ?? null,
        outletName: (u.outletName as string | null) ?? null,
        mfaEnrolled: !!u.mfaEnrolled,
        mustEnrol2fa: !!u.mustEnrol2fa,
        lastSignInAt: (u.lastSignInAt as Date | null) ?? null,
      })),
    };
  }

  // Recovery for a shop user who lost their device AND their recovery codes (a
  // sole shop admin has nobody else to reset them). One transaction: the
  // removal of the second factor, the revoke of every session, the "must enrol
  // again" flag, the notification email and the platform audit row commit
  // together, so a failed audit insert rolls the whole reset back. The shop is
  // part of every statement's WHERE: a user id from another shop is the same 404
  // as one that does not exist. Nothing secret is read or returned.
  async resetShopUserTwoFactor(
    platformAdminId: number,
    shopId: number,
    userId: number,
  ): Promise<{ success: true }> {
    await this.db.transaction(async (conn) => {
      const [users] = await conn.query<RowDataPacket[]>(
        `SELECT id, name, email, role FROM user WHERE id = ? AND shopId = ? FOR UPDATE`,
        [userId, shopId],
      );
      const user = users[0];
      if (!user) throw new NotFoundException('User not found');

      const [enrolledRows] = await conn.query<RowDataPacket[]>(
        `SELECT 1 FROM usertotp WHERE userId = ? AND confirmedAt IS NOT NULL`,
        [userId],
      );
      const wasEnrolled = enrolledRows.length > 0;

      await this.staffMfa.disableOn(conn, userId);
      // An enrolled user must enrol again even in a shop that does not require
      // it; a user who never had a second factor is not forced into one.
      if (wasEnrolled) {
        await conn.query(
          `UPDATE user SET mustEnrol2fa = 1 WHERE id = ? AND shopId = ?`,
          [userId, shopId],
        );
      }
      const [revoked] = await conn.query<ResultSetHeader>(
        `UPDATE refreshtoken SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL`,
        [new Date(), userId],
      );

      await this.jobs.enqueue(
        shopId,
        'send_email',
        {
          to: user.email as string,
          subject: 'Two-factor authentication was reset on your Requital account',
          bodyText:
            'Requital support reset two-factor authentication on your account at your request. ' +
            'You have been signed out everywhere. Sign in with your password and set up two-factor again. ' +
            'If you did not ask for this, contact Requital support immediately and change your password.',
          html: `<p>Hi ${escapeHtml(user.name as string)},</p><p>Requital support reset two-factor authentication on your account at your request. You have been signed out everywhere. Sign in with your password and set up two-factor again.</p><p>If you did not ask for this, contact Requital support immediately and change your password.</p>`,
        },
        `platform-2fa-reset-email:${userId}:${randomUUID()}`,
        { tx: conn },
      );

      await this.platformAuditLogService.log(
        platformAdminId,
        'shop.user_2fa_reset',
        shopId,
        {
          userId,
          role: user.role as string,
          wasEnrolled,
          sessionsRevoked: revoked.affectedRows,
        },
        conn,
      );
    });
    return { success: true };
  }

  // Shops whose delivery zones are still matched by free-text name because at
  // least one active zone has not had its regions confirmed. Read-only.
  async listLegacyZoneMappingShops() {
    const rows = await this.db.query<
      ({
        shopId: number;
        subdomain: string;
        unconfirmedActiveZones: number;
      } & RowDataPacket)[]
    >(
      `SELECT s.id AS shopId, s.subdomain, COUNT(*) AS unconfirmedActiveZones
         FROM deliveryzone dz
         JOIN outlet o ON o.id = dz.outletId
         JOIN shop s ON s.id = o.shopId
        WHERE dz.isActive = 1 AND dz.mappingConfirmedAt IS NULL
        GROUP BY s.id, s.subdomain
        ORDER BY s.id`,
    );
    return {
      legacyShops: rows.length,
      shops: rows.map((r) => ({
        shopId: r.shopId,
        subdomain: r.subdomain,
        unconfirmedActiveZones: Number(r.unconfirmedActiveZones),
      })),
    };
  }

  // Paginated because this is the one platform list that was genuinely
  // unbounded, and a dev database with 26k leftover shops (repeated e2e runs)
  // has crashed a verification script trying to enumerate it. Returns the
  // same { data, page, pageSize, total } envelope CustomersService.findAll
  // does. The two sibling lists (webhook-log, audit-log) were already
  // hard-capped at 100 rows server-side, so neither can produce this.
  async listShops(query: {
    q?: string;
    status?: ShopStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions: string[] = [];
    const params: QueryParam[] = [];
    if (query.q) {
      conditions.push('(s.name LIKE ? OR s.subdomain LIKE ?)');
      params.push(`%${query.q}%`, `%${query.q}%`);
    }
    if (query.status === 'suspended') {
      conditions.push('s.suspendedAt IS NOT NULL');
    } else if (query.status === 'active') {
      conditions.push('s.suspendedAt IS NULL');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT s.id, s.name, s.subdomain, s.published, s.suspendedAt, s.createdAt,
              (SELECT COUNT(*) FROM \`order\` o WHERE o.shopId = s.id) AS orderCount,
              (SELECT MAX(o.createdAt) FROM \`order\` o WHERE o.shopId = s.id) AS lastOrderAt
       FROM shop s
       ${where}
       ORDER BY s.createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    // Counted without the two correlated order subqueries the page itself
    // needs - COUNT(*) over `shop` alone, so the total does not pay for them.
    const totalRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM shop s ${where}`,
      params,
    );

    const data = rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      subdomain: r.subdomain as string,
      status: r.suspendedAt ? 'suspended' : 'active',
      published: !!r.published,
      createdAt: r.createdAt as Date,
      orderCount: Number(r.orderCount),
      lastActivityAt: (r.lastOrderAt as Date | null) ?? (r.createdAt as Date),
    }));

    return { data, page, pageSize, total: Number(totalRows[0].total) };
  }

  async getShopDetail(shopId: number) {
    const shop = await this.findShopOrThrow(shopId);
    const [ownerRows, outlets, orderStatsRows, paymentProviderRows] =
      await Promise.all([
        this.db.query<
          ({
            name: string;
            email: string;
            phone: string | null;
          } & RowDataPacket)[]
        >(
          `SELECT name, email, phone FROM user WHERE shopId = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
          [shopId],
        ),
        this.db.query<(OutletRow & RowDataPacket)[]>(
          `SELECT * FROM outlet WHERE shopId = ? ORDER BY id ASC`,
          [shopId],
        ),
        this.db.query<
          ({ orderCount: number; lastOrderAt: Date | null } & RowDataPacket)[]
        >(
          `SELECT COUNT(*) AS orderCount, MAX(createdAt) AS lastOrderAt FROM \`order\` WHERE shopId = ?`,
          [shopId],
        ),
        this.db.query<({ provider: string } & RowDataPacket)[]>(
          `SELECT provider FROM shoppaymentprovider WHERE shopId = ? AND enabled = 1`,
          [shopId],
        ),
      ]);

    const sliderStatus = await this.sliderSettingsService.find({
      shopId,
      userId: 0,
      role: 'admin',
      outletId: null,
    });

    return {
      id: shop.id,
      name: shop.name,
      subdomain: shop.subdomain,
      status: shop.suspendedAt ? 'suspended' : 'active',
      published: shop.published,
      createdAt: shop.createdAt,
      owner: ownerRows[0]
        ? {
            name: ownerRows[0].name,
            email: ownerRows[0].email,
            phone: ownerRows[0].phone,
          }
        : null,
      outlets: outlets.map((o) => ({
        id: o.id,
        name: o.name,
        active: o.active,
      })),
      orderCount: Number(orderStatsRows[0]?.orderCount ?? 0),
      lastActivityAt: orderStatsRows[0]?.lastOrderAt ?? shop.createdAt,
      integrations: {
        slider: sliderStatus,
        // Names only, per scope — never a credential/enabled-detail dump.
        paymentProviders: [
          ...(shop.paymentGateway ? [shop.paymentGateway] : []),
          ...paymentProviderRows.map((r) => r.provider),
        ],
        whatsappConfigured: shop.whatsappCredentials !== null,
      },
    };
  }

  async suspend(platformAdminId: number, shopId: number) {
    await this.findShopOrThrow(shopId);
    await this.db.execute(`UPDATE shop SET suspendedAt = ? WHERE id = ?`, [
      new Date(),
      shopId,
    ]);
    await this.platformAuditLogService.log(
      platformAdminId,
      'shop.suspend',
      shopId,
    );
    return this.getShopDetail(shopId);
  }

  async unsuspend(platformAdminId: number, shopId: number) {
    await this.findShopOrThrow(shopId);
    await this.db.execute(`UPDATE shop SET suspendedAt = NULL WHERE id = ?`, [
      shopId,
    ]);
    await this.platformAuditLogService.log(
      platformAdminId,
      'shop.unsuspend',
      shopId,
    );
    return this.getShopDetail(shopId);
  }

  // Mints the token first, then logs — see PlatformAuditLogService's own
  // comment on why the log write is a hard precondition of returning the
  // token to the caller (must exist even if the process dies right after).
  async impersonate(platformAdminId: number, shopId: number) {
    await this.findShopOrThrow(shopId);
    const session = await this.authService.issueImpersonationTokenForShop(
      shopId,
      platformAdminId,
    );
    await this.platformAuditLogService.log(
      platformAdminId,
      'shop.impersonate',
      shopId,
      {
        impersonatedUserId: session.user.id,
      },
    );
    return session;
  }

  async listFeatures(shopId: number) {
    const statuses = await this.features.describe(shopId);
    if (!statuses) throw new NotFoundException(`Shop ${shopId} not found`);
    return statuses;
  }

  private assertFeatureKey(key: string) {
    if (!isFeatureKey(key)) throw new NotFoundException('Unknown feature');
    return key;
  }

  // The override and its audit entry are one transaction: if the audit insert
  // fails the override is rolled back and the request fails (same hard
  // precondition as impersonation, but atomic).
  async setFeatureOverride(
    platformAdminId: number,
    shopId: number,
    rawKey: string,
    enabled: boolean,
    note: string | null,
  ) {
    const key = this.assertFeatureKey(rawKey);
    await this.findShopOrThrow(shopId);
    await this.db.transaction(async (conn) => {
      await this.features.setOverride(
        conn,
        shopId,
        key,
        enabled,
        note,
        platformAdminId,
      );
      await this.platformAuditLogService.log(
        platformAdminId,
        'shop.feature_override.set',
        shopId,
        { key, enabled, note },
        conn,
      );
    });
    return this.listFeatures(shopId);
  }

  async clearFeatureOverride(
    platformAdminId: number,
    shopId: number,
    rawKey: string,
  ) {
    const key = this.assertFeatureKey(rawKey);
    await this.findShopOrThrow(shopId);
    await this.db.transaction(async (conn) => {
      if (await this.features.clearOverride(conn, shopId, key)) {
        await this.platformAuditLogService.log(
          platformAdminId,
          'shop.feature_override.clear',
          shopId,
          { key },
          conn,
        );
      }
    });
    return this.listFeatures(shopId);
  }

  async sliderTestDispatch(shopId: number) {
    assertShopCountryIsUae((await this.findShopOrThrow(shopId)).countryCode);
    const outlets = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE shopId = ? AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    const outlet = outlets[0];
    if (!outlet) {
      throw new BadRequestException(
        'This shop has no outlet with map coordinates set to test against',
      );
    }
    const credentials =
      await this.sliderSettingsService.buildTestCredentials(shopId);
    const point = { latitude: outlet.latitude!, longitude: outlet.longitude! };
    const quote = await this.sliderProvider.getQuote({
      pickup: point,
      delivery: point,
      credentials,
    });
    // Slider's fare endpoint carries no currency; the fares are in Slider's
    // own (AED), not the viewed shop's, so the panel must not label them with
    // the shop's currency.
    return { ...quote, currency: SLIDER_CURRENCY };
  }

  // Configured/not-configured only, never a value — see CLAUDE.md's
  // platform-admin security requirements. Google Maps' key lives in each
  // frontend's own NEXT_PUBLIC_GOOGLE_MAPS_API_KEY build-time env, not
  // this backend's process, so it's deliberately not reported here rather
  // than faked from an env var this process can't actually see.
  getSettingsStatus() {
    const names = [
      'SLIDER_API_KEY',
      'SLIDER_ENVIRONMENT',
      'SLIDER_WEBHOOK_TOKEN',
      'STRIPE_SECRET_KEY',
      'RESEND_API_KEY',
      'CREDENTIAL_ENCRYPTION_KEY',
      'PLATFORM_WHATSAPP_ACCESS_TOKEN',
      'PLATFORM_JWT_SECRET',
    ] as const;
    return names.map((name) => ({ name, configured: !!process.env[name] }));
  }

  private async findShopOrThrow(shopId: number): Promise<ShopRow> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE id = ?`,
      [shopId],
    );
    if (!rows[0]) throw new NotFoundException(`Shop ${shopId} not found`);
    return rows[0];
  }
}
