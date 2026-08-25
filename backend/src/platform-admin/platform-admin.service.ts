import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { AuthService } from '../auth/auth.service';
import { SliderSettingsService } from '../delivery-providers/slider-settings.service';
import { SliderDeliveryProvider } from '../delivery-providers/slider/slider-delivery.provider';
import { PlatformAuditLogService } from './platform-audit-log.service';
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
  ) {}

  async listShops(query: { q?: string; status?: ShopStatus }) {
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
       ORDER BY s.createdAt DESC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      subdomain: r.subdomain as string,
      status: r.suspendedAt ? 'suspended' : 'active',
      published: !!r.published,
      createdAt: r.createdAt as Date,
      orderCount: Number(r.orderCount),
      lastActivityAt: (r.lastOrderAt as Date | null) ?? (r.createdAt as Date),
    }));
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

  async sliderTestDispatch(shopId: number) {
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
    return this.sliderProvider.getQuote({
      pickup: point,
      delivery: point,
      credentials,
    });
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
