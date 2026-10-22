import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { MapsErrorLogRow, ShopRow } from '../db/types';
import { shopOwnHosts } from '../common/storefront-url';
import { normalizeBeaconHost } from './maps-error-codes';
import type { ReportMapsErrorDto } from './dto/report-maps-error.dto';

const WINDOW_DAYS = 14;

@Injectable()
export class MapsHealthService {
  constructor(private readonly db: DatabaseService) {}

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
    await this.db.execute(
      `INSERT INTO mapserrorlog (shopId, code, host, hitCount, firstSeenAt, lastSeenAt)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE hitCount = LEAST(hitCount + 1, 4294967295), lastSeenAt = VALUES(lastSeenAt)`,
      [shop.id, dto.code, host, new Date(), new Date()],
    );
  }

  async list(shopId: number) {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.db.query<(MapsErrorLogRow & RowDataPacket)[]>(
      `SELECT code, host, hitCount, lastSeenAt FROM mapserrorlog
       WHERE shopId = ? AND lastSeenAt >= ? ORDER BY lastSeenAt DESC`,
      [shopId, since],
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
}
