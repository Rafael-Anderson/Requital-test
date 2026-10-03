import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { NotFoundLogRow, ShopRow, UrlRedirectRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { parseCsv } from '../common/csv.util';
import { shopOwnHosts } from '../common/storefront-url';
import { CreateUrlRedirectDto } from './dto/create-url-redirect.dto';
import { UpdateUrlRedirectDto } from './dto/update-url-redirect.dto';
import { ListUrlRedirectsQueryDto } from './dto/list-url-redirects-query.dto';
import { LogNotFoundDto } from './dto/log-not-found.dto';
import { RedirectHitDto } from './dto/record-redirect-hits.dto';
import {
  MAX_REDIRECTS_PER_SHOP,
  canonicalizeRequestPath,
  checkChain,
  normalizeNotFoundPath,
  referrerHost,
  resolveRedirect,
  validateFromPath,
  validateStatusCode,
  validateTarget,
  type RedirectEntry,
  type ResolvedRedirect,
  type ValidTarget,
} from './redirect-rules';

// The 404 log is written by an UNAUTHENTICATED endpoint, so it is advisory and
// bounded: distinct paths per shop are capped and the least valuable row is
// evicted to make room (fewest hits, then oldest), so junk cannot grow the
// table and a flood of one-off junk paths cannot displace a path that has been
// hit many times.
const MAX_NOT_FOUND_PATHS_PER_SHOP = 5_000;
const MAX_IMPORT_ROWS = MAX_REDIRECTS_PER_SHOP;
const IMPORT_REPORT_ROW_CAP = 1_000;
const UPSERT_CHUNK = 500;

export type ImportAction = 'create' | 'update' | 'skip' | 'error';

export interface ImportRowReport {
  rowNumber: number;
  from: string;
  to: string;
  status: number;
  action: ImportAction;
  errors: string[];
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  // Errors first, then the rest, capped; the counts above are always complete.
  rows: ImportRowReport[];
  truncated: boolean;
}

interface PlannedRow {
  from: string;
  to: string;
  status: number;
  action: 'create' | 'update' | 'skip';
}

type RedirectRow = UrlRedirectRow & RowDataPacket;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class UrlRedirectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- admin

  async list(ctx: TenantContext, query: ListUrlRedirectsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = ['shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (query.search?.trim()) {
      const like = `%${escapeLike(query.search.trim().toLowerCase())}%`;
      where.push('(fromPath LIKE ? OR toTarget LIKE ?)');
      params.push(like, like);
    }
    const [countRows, data] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM urlredirect WHERE ${where.join(' AND ')}`,
        params,
      ),
      this.db.query<RedirectRow[]>(
        `SELECT * FROM urlredirect WHERE ${where.join(' AND ')}
         ORDER BY ${query.sort === 'hits' ? 'hitCount DESC, id DESC' : 'id DESC'}
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
    ]);
    return {
      data,
      page,
      pageSize,
      total: Number(countRows[0].total),
      limit: MAX_REDIRECTS_PER_SHOP,
    };
  }

  async create(ctx: TenantContext, dto: CreateUrlRedirectDto) {
    const shop = await this.loadShopById(ctx.shopId);
    const hosts = shopOwnHosts(shop);
    const existing = await this.loadEntries(ctx.shopId);
    if (existing.size >= MAX_REDIRECTS_PER_SHOP) {
      throw new ConflictException(
        `A shop can have at most ${MAX_REDIRECTS_PER_SHOP} redirects`,
      );
    }
    const valid = this.validateOne(
      dto.fromPath,
      dto.toTarget,
      dto.statusCode ?? 301,
      existing,
      hosts,
    );
    const active = dto.active ?? true;
    try {
      const result = await this.db.execute(
        `INSERT INTO urlredirect (shopId, fromPath, toTarget, statusCode, active, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          valid.from,
          valid.target.value,
          valid.status,
          active,
          new Date(),
        ],
      );
      await this.auditLogService.logCtx(ctx, {
        action: 'url_redirect.created',
        entityType: 'url_redirect',
        entityId: result.insertId,
        after: { fromPath: valid.from, toTarget: valid.target.value },
      });
      return this.findOne(ctx, result.insertId);
    } catch (error) {
      this.rethrowDuplicate(error, valid.from);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateUrlRedirectDto) {
    const current = await this.findOne(ctx, id);
    const shop = await this.loadShopById(ctx.shopId);
    const hosts = shopOwnHosts(shop);
    const existing = await this.loadEntries(ctx.shopId);
    // Validate the edited row against everyone ELSE: its own old entry must not
    // take part in the loop/chain walk.
    existing.delete(current.fromPath);
    const valid = this.validateOne(
      dto.fromPath ?? current.fromPath,
      dto.toTarget ?? current.toTarget,
      dto.statusCode ?? current.statusCode,
      existing,
      hosts,
    );
    try {
      await this.db.execute(
        `UPDATE urlredirect SET fromPath = ?, toTarget = ?, statusCode = ?, active = ?, updatedAt = ?
         WHERE id = ? AND shopId = ?`,
        [
          valid.from,
          valid.target.value,
          valid.status,
          dto.active ?? current.active,
          new Date(),
          id,
          ctx.shopId,
        ],
      );
    } catch (error) {
      this.rethrowDuplicate(error, valid.from);
    }
    await this.auditLogService.logCtx(ctx, {
      action: 'url_redirect.updated',
      entityType: 'url_redirect',
      entityId: id,
      before: { fromPath: current.fromPath, toTarget: current.toTarget },
      after: { fromPath: valid.from, toTarget: valid.target.value },
    });
    return this.findOne(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const current = await this.findOne(ctx, id);
    await this.db.execute(
      `DELETE FROM urlredirect WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    await this.auditLogService.logCtx(ctx, {
      action: 'url_redirect.deleted',
      entityType: 'url_redirect',
      entityId: id,
      before: { fromPath: current.fromPath, toTarget: current.toTarget },
    });
    return { deleted: true };
  }

  private async findOne(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RedirectRow[]>(
      `SELECT * FROM urlredirect WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0)
      throw new NotFoundException(`Redirect ${id} not found`);
    return rows[0];
  }

  // CSV import. Preview and confirm run the SAME plan() so they cannot
  // disagree; confirm re-parses and re-validates the uploaded file itself (the
  // client re-submits the file, nothing from the preview is trusted).
  async previewImport(ctx: TenantContext, file: Express.Multer.File) {
    const { report } = await this.planImport(ctx, file);
    return report;
  }

  async confirmImport(ctx: TenantContext, file: Express.Multer.File) {
    const { report, planned } = await this.planImport(ctx, file);
    const writes = planned.filter((p) => p.action !== 'skip');
    const creates = planned.filter((p) => p.action === 'create').length;
    const existingCount = await this.countRows(ctx.shopId);
    if (existingCount + creates > MAX_REDIRECTS_PER_SHOP) {
      throw new BadRequestException(
        `This import would take the shop over ${MAX_REDIRECTS_PER_SHOP} redirects`,
      );
    }
    const now = new Date();
    await this.db.transaction(async (conn) => {
      for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
        const chunk = writes.slice(i, i + UPSERT_CHUNK);
        await conn.query(
          `INSERT INTO urlredirect (shopId, fromPath, toTarget, statusCode, active, updatedAt)
           VALUES ?
           ON DUPLICATE KEY UPDATE toTarget = VALUES(toTarget), statusCode = VALUES(statusCode),
             active = TRUE, updatedAt = VALUES(updatedAt)`,
          [chunk.map((p) => [ctx.shopId, p.from, p.to, p.status, true, now])],
        );
      }
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'url_redirect.imported',
      entityType: 'url_redirect',
      metadata: {
        created: report.created,
        updated: report.updated,
        skipped: report.skipped,
        errors: report.errors,
      },
    });
    return report;
  }

  private async planImport(ctx: TenantContext, file: Express.Multer.File) {
    const rawRows = parseCsv(file.buffer.toString('utf-8')).map((row) => {
      const lowered: Record<string, string> = {};
      for (const [k, v] of Object.entries(row))
        lowered[k.trim().toLowerCase()] = v;
      return lowered;
    });
    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `A file can have at most ${MAX_IMPORT_ROWS} rows`,
      );
    }
    const fromKey = ['from', 'redirect from'].find(
      (k) => rawRows[0] && k in rawRows[0],
    );
    const toKey = ['to', 'redirect to'].find(
      (k) => rawRows[0] && k in rawRows[0],
    );
    if (rawRows.length > 0 && (!fromKey || !toKey)) {
      throw new BadRequestException(
        'The file needs "from" and "to" columns (and optionally "status")',
      );
    }

    const shop = await this.loadShopById(ctx.shopId);
    const hosts = shopOwnHosts(shop);
    const existing = await this.loadEntries(ctx.shopId);

    // Pass 1: syntax + safety per row, de-duplicating within the file.
    interface Candidate {
      rowNumber: number;
      from: string;
      target: ValidTarget;
      status: 301 | 302;
      errors: string[];
      rawFrom: string;
      rawTo: string;
    }
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    rawRows.forEach((row, i) => {
      const rawFrom = (fromKey && row[fromKey]) || '';
      const rawTo = (toKey && row[toKey]) || '';
      const errors: string[] = [];
      const from = validateFromPath(rawFrom);
      if (!from.ok) errors.push(from.error);
      const target = validateTarget(rawTo, hosts);
      if (!target.ok) errors.push(target.error);
      const rawStatus = (row['status'] ?? '').trim();
      const status = validateStatusCode(
        rawStatus === '' ? 301 : Number(rawStatus),
      );
      if (!status.ok) errors.push(status.error);
      if (from.ok) {
        if (seen.has(from.value))
          errors.push('Duplicate "from" earlier in this file');
        seen.add(from.value);
      }
      candidates.push({
        rowNumber: i + 2,
        from: from.ok ? from.value : rawFrom,
        target: target.ok
          ? target.value
          : { value: rawTo, kind: 'path', canonicalPath: null },
        status: status.ok ? status.value : 301,
        errors,
        rawFrom,
        rawTo,
      });
    });

    // Pass 2: loops and long chains against the FINAL state (existing rows
    // overlaid with every syntactically valid row of this file).
    const finalState = new Map(existing);
    for (const c of candidates) {
      if (c.errors.length === 0) {
        finalState.set(c.from, {
          fromPath: c.from,
          toTarget: c.target.value,
          statusCode: c.status,
          active: true,
        });
      }
    }
    for (const c of candidates) {
      if (c.errors.length > 0) continue;
      const chain = checkChain(c.from, c.target, finalState, hosts);
      if (chain) c.errors.push(chain);
    }

    const planned: PlannedRow[] = [];
    const reportRows: ImportRowReport[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    for (const c of candidates) {
      let action: ImportAction;
      if (c.errors.length > 0) {
        action = 'error';
        errors += 1;
      } else {
        const current = existing.get(c.from);
        if (!current) {
          action = 'create';
          created += 1;
        } else if (
          current.toTarget === c.target.value &&
          current.statusCode === c.status &&
          current.active
        ) {
          action = 'skip';
          skipped += 1;
        } else {
          action = 'update';
          updated += 1;
        }
        planned.push({
          from: c.from,
          to: c.target.value,
          status: c.status,
          action,
        });
      }
      reportRows.push({
        rowNumber: c.rowNumber,
        from: c.rawFrom.slice(0, 200),
        to: c.rawTo.slice(0, 200),
        status: c.status,
        action,
        errors: c.errors,
      });
    }
    const ordered = [
      ...reportRows.filter((r) => r.action === 'error'),
      ...reportRows.filter((r) => r.action !== 'error'),
    ];
    const report: ImportReport = {
      total: candidates.length,
      created,
      updated,
      skipped,
      errors,
      rows: ordered.slice(0, IMPORT_REPORT_ROW_CAP),
      truncated: ordered.length > IMPORT_REPORT_ROW_CAP,
    };
    return { report, planned };
  }

  async listNotFound(ctx: TenantContext, query: ListUrlRedirectsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = ['n.shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (query.search?.trim()) {
      where.push('n.path LIKE ?');
      params.push(`%${escapeLike(query.search.trim().toLowerCase())}%`);
    }
    const [countRows, data] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM notfoundlog n WHERE ${where.join(' AND ')}`,
        params,
      ),
      this.db.query<
        (NotFoundLogRow & RowDataPacket & { redirectId: number | null })[]
      >(
        `SELECT n.*, r.id AS redirectId
         FROM notfoundlog n
         LEFT JOIN urlredirect r ON r.shopId = n.shopId AND r.fromPath = n.path
         WHERE ${where.join(' AND ')}
         ORDER BY ${query.sort === 'recent' ? 'n.lastSeenAt DESC' : 'n.hitCount DESC, n.lastSeenAt DESC'}
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
    ]);
    return {
      data: data.map((row) => ({
        id: row.id,
        path: row.path,
        hitCount: row.hitCount,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        lastReferrer: row.lastReferrer,
        hasRedirect: row.redirectId !== null,
      })),
      page,
      pageSize,
      total: Number(countRows[0].total),
    };
  }

  async dismissNotFound(ctx: TenantContext, id: number) {
    const result = await this.db.execute(
      `DELETE FROM notfoundlog WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException(`Log entry ${id} not found`);
    }
    return { deleted: true };
  }

  async clearNotFound(ctx: TenantContext) {
    const result = await this.db.execute(
      `DELETE FROM notfoundlog WHERE shopId = ?`,
      [ctx.shopId],
    );
    await this.auditLogService.logCtx(ctx, {
      action: 'url_redirect.not_found_log_cleared',
      entityType: 'url_redirect',
      metadata: { cleared: result.affectedRows },
    });
    return { cleared: result.affectedRows };
  }

  // --------------------------------------------------------------- public
  // Every method re-resolves the shop from the slug and scopes every query by
  // its id. A suspended or unpublished shop answers 404, exactly like the rest
  // of /public.

  async resolve(
    shopSlug: string,
    rawPath: string,
  ): Promise<ResolvedRedirect | null> {
    const shop = await this.resolvePublicShop(shopSlug);
    const requestPath = canonicalizeRequestPath(rawPath ?? '');
    if (requestPath === null || requestPath === '/') return null;
    const hosts = shopOwnHosts(shop);
    // Only the (at most) two rows a resolution can touch, never the whole map.
    const first = await this.db.query<RedirectRow[]>(
      `SELECT * FROM urlredirect WHERE shopId = ? AND fromPath = ? AND active = 1`,
      [shop.id, requestPath],
    );
    if (first.length === 0) return null;
    const entries = new Map<string, RedirectEntry>([
      [requestPath, this.toEntry(first[0])],
    ]);
    const firstTarget = validateTarget(first[0].toTarget, hosts);
    if (firstTarget.ok && firstTarget.value.canonicalPath) {
      const next = await this.db.query<RedirectRow[]>(
        `SELECT * FROM urlredirect WHERE shopId = ? AND fromPath = ? AND active = 1`,
        [shop.id, firstTarget.value.canonicalPath],
      );
      if (next.length > 0) {
        entries.set(firstTarget.value.canonicalPath, this.toEntry(next[0]));
      }
    }
    return resolveRedirect(requestPath, entries, hosts);
  }

  // The whole resolved map for one shop, for storefront/proxy.ts to hold for
  // 30s and match in-process (see that file for why this and not a call per
  // request). Versioned by ETag so an unchanged map costs one COUNT/MAX query
  // and no body. The version includes the shop's current hosts so a domain
  // disconnect re-validates every absolute target even if no row changed.
  async getMap(shopSlug: string, ifNoneMatch: string | undefined) {
    const shop = await this.resolvePublicShop(shopSlug);
    const hosts = shopOwnHosts(shop);
    const agg = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c, DATE_FORMAT(MAX(updatedAt), '%Y%m%d%H%i%s%f') AS m
       FROM urlredirect WHERE shopId = ?`,
      [shop.id],
    );
    const version = createHash('sha1')
      .update(`${String(agg[0].c)}|${String(agg[0].m)}|${hosts.join(',')}`)
      .digest('hex');
    const etag = `"${version}"`;
    if (ifNoneMatch === etag) return { etag, notModified: true as const };

    const entries = await this.loadEntries(shop.id);
    const out: { from: string; to: string; status: number }[] = [];
    for (const entry of entries.values()) {
      if (!entry.active) continue;
      const resolved = resolveRedirect(entry.fromPath, entries, hosts);
      if (resolved) {
        out.push({
          from: entry.fromPath,
          to: resolved.to,
          status: resolved.status,
        });
      }
    }
    return { etag, notModified: false as const, hosts, entries: out };
  }

  // Advisory counter, spoofable by anyone who can call the public API: it only
  // ever increments rows that already exist for THIS shop, clamped per entry,
  // and nothing in the product depends on the number.
  async recordHits(shopSlug: string, hits: RedirectHitDto[]) {
    const shop = await this.resolvePublicShop(shopSlug);
    for (const hit of hits) {
      const path = canonicalizeRequestPath(hit.path);
      if (path === null) continue;
      await this.db.execute(
        `UPDATE urlredirect
         SET hitCount = LEAST(hitCount + ?, 4294967295), lastHitAt = ?
         WHERE shopId = ? AND fromPath = ?`,
        [hit.count, new Date(), shop.id, path],
      );
    }
  }

  async logNotFound(shopSlug: string, dto: LogNotFoundDto) {
    const shop = await this.resolvePublicShop(shopSlug);
    const path = normalizeNotFoundPath(dto.path);
    if (path === null) return;
    const referrer = referrerHost(dto.referrer);
    const now = new Date();

    const bumped = await this.db.execute(
      `UPDATE notfoundlog
       SET hitCount = hitCount + 1, lastSeenAt = ?, lastReferrer = COALESCE(?, lastReferrer)
       WHERE shopId = ? AND path = ?`,
      [now, referrer, shop.id, path],
    );
    if (bumped.affectedRows > 0) return;

    // New distinct path: enforce the per-shop cap by evicting the least
    // valuable row. Soft under concurrency (it can overshoot by the number of
    // simultaneous requests); the cap exists to bound growth, not to be exact.
    const count = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM notfoundlog WHERE shopId = ?`,
      [shop.id],
    );
    if (Number(count[0].c) >= MAX_NOT_FOUND_PATHS_PER_SHOP) {
      await this.db.execute(
        `DELETE FROM notfoundlog WHERE shopId = ?
         ORDER BY hitCount ASC, lastSeenAt ASC LIMIT 1`,
        [shop.id],
      );
    }
    await this.db.execute(
      `INSERT INTO notfoundlog (shopId, path, hitCount, firstSeenAt, lastSeenAt, lastReferrer)
       VALUES (?, ?, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE hitCount = hitCount + 1, lastSeenAt = VALUES(lastSeenAt),
         lastReferrer = COALESCE(VALUES(lastReferrer), lastReferrer)`,
      [shop.id, path, now, now, referrer],
    );
  }

  // -------------------------------------------------------------- helpers

  private validateOne(
    rawFrom: string,
    rawTo: string,
    rawStatus: number,
    existing: ReadonlyMap<string, RedirectEntry>,
    hosts: readonly string[],
  ) {
    const from = validateFromPath(rawFrom);
    if (!from.ok) throw new BadRequestException(from.error);
    const target = validateTarget(rawTo, hosts);
    if (!target.ok) throw new BadRequestException(target.error);
    const status = validateStatusCode(rawStatus);
    if (!status.ok) throw new BadRequestException(status.error);
    const chain = checkChain(from.value, target.value, existing, hosts);
    if (chain) throw new BadRequestException(chain);
    return { from: from.value, target: target.value, status: status.value };
  }

  private rethrowDuplicate(error: unknown, from: string): never {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException(`A redirect from ${from} already exists`);
    }
    throw error;
  }

  private toEntry(row: UrlRedirectRow): RedirectEntry {
    return {
      fromPath: row.fromPath,
      toTarget: row.toTarget,
      statusCode: row.statusCode,
      active: row.active,
    };
  }

  private async loadEntries(
    shopId: number,
  ): Promise<Map<string, RedirectEntry>> {
    const rows = await this.db.query<RedirectRow[]>(
      `SELECT fromPath, toTarget, statusCode, active FROM urlredirect WHERE shopId = ?`,
      [shopId],
    );
    return new Map(rows.map((r) => [r.fromPath, this.toEntry(r)]));
  }

  private async countRows(shopId: number): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM urlredirect WHERE shopId = ?`,
      [shopId],
    );
    return Number(rows[0].c);
  }

  private async loadShopById(shopId: number): Promise<ShopRow> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE id = ? LIMIT 1`,
      [shopId],
    );
    if (rows.length === 0) throw new NotFoundException('Shop not found');
    return rows[0];
  }

  private async resolvePublicShop(shopSlug: string): Promise<ShopRow> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ? LIMIT 1`,
      [shopSlug],
    );
    const shop = rows[0];
    // Suspended and unpublished shops serve nothing, same as the rest of
    // /public (PublicService.resolveShop + assertPublished).
    if (!shop || shop.suspendedAt || !shop.published) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    return shop;
  }
}
