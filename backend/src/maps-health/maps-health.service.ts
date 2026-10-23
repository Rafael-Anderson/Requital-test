import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { MapsErrorLogRow, ShopRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { shopOwnHosts } from '../common/storefront-url';
import { normalizeBeaconHost } from './maps-error-codes';
import type { ReportMapsErrorDto } from './dto/report-maps-error.dto';

// Only reports newer than this are shown.
const WINDOW_DAYS = 7;
// The beacon is unauthenticated, so one request must not be able to raise the
// merchant's banner. A problem counts once it has been reported at least this
// many times AND over a span of at least this many minutes (so the hits fall in
// at least two different hours). Storage stays bounded either way: one row per
// (shop, code, own host).
export const MIN_HITS = 3;
export const MIN_SPAN_MINUTES = 60;

@Injectable()
export class MapsHealthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Public beacon. Advisory: it can only ever touch rows keyed by this shop, one
  // of four codes and one of the shop's own hosts (at most a handful of rows per
  // shop), so spoofing it cannot grow storage or reach another tenant. A host
  // that is not the shop's own is dropped silently so the endpoint never
  // reveals which hosts a shop has.
  async report(shopSlug: string, dto: ReportMapsErrorDto) {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ? LIMIT 1`,
      [shopSlug],
    );
    const shop = rows[0];
    if (!shop || shop.suspendedAt || !shop.published) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    const host = normalizeBeaconHost(dto.host);
    if (!shopOwnHosts(shop).includes(host)) return;
    const now = new Date();
    // MySQL applies the assignments left to right: firstSeenAt must be decided
    // from the OLD hitCount (0 right after a resolve = a fresh run of hits).
    await this.db.execute(
      `INSERT INTO mapserrorlog (shopId, code, host, hitCount, firstSeenAt, lastSeenAt)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         firstSeenAt = IF(hitCount = 0, VALUES(firstSeenAt), firstSeenAt),
         hitCount = LEAST(hitCount + 1, 4294967295),
         lastSeenAt = VALUES(lastSeenAt)`,
      [shop.id, dto.code, host, now, now],
    );
  }

  // What the admin banner shows: only problems reported often enough, over a long
  // enough span, recently.
  async list(shopId: number) {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.db.query<(MapsErrorLogRow & RowDataPacket)[]>(
      `SELECT code, host, hitCount, firstSeenAt, lastSeenAt FROM mapserrorlog
       WHERE shopId = ? AND lastSeenAt >= ? AND hitCount >= ?
         AND TIMESTAMPDIFF(MINUTE, firstSeenAt, lastSeenAt) >= ?
       ORDER BY lastSeenAt DESC`,
      [shopId, since, MIN_HITS, MIN_SPAN_MINUTES],
    );
    return {
      errors: rows.map((r) => ({
        code: r.code,
        host: r.host,
        hitCount: r.hitCount,
        lastSeenAt: r.lastSeenAt,
      })),
    };
  }

  // "Mark resolved": from now on only hits AFTER this moment count. One
  // statement scoped by shopId, so another shop's row (or an unknown one) is a 404.
  async resolve(ctx: TenantContext, code: string, host: string) {
    const normalized = normalizeBeaconHost(host);
    const result = await this.db.execute(
      `UPDATE mapserrorlog SET resolvedAt = ?, hitCount = 0
       WHERE shopId = ? AND code = ? AND host = ?`,
      [new Date(), ctx.shopId, code, normalized],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException('No such report');
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'maps_health.resolved',
      entityType: 'maps_health',
      metadata: { code, host: normalized },
    });
    return { resolved: true };
  }
}
