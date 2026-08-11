import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantContext } from '../common/tenant-context';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';

interface LogEntry {
  action: string;
  entityType: string;
  entityId?: number;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly db: DatabaseService) {}

  // Takes shopId/actorUserId directly rather than TenantContext — login
  // (the one caller with no ctx yet, since it's what produces one) needs
  // this too. Every other call site just passes {shopId: ctx.shopId,
  // actorUserId: ctx.userId}.
  //
  // Deliberately swallows its own errors: a broken audit write must never
  // fail the real operation it's describing (imagine a product delete
  // succeeding but the request 500ing because the log insert hit some
  // unrelated DB hiccup — the delete already happened, the error would be a
  // lie).
  async log(actor: { shopId: number; actorUserId: number }, entry: LogEntry) {
    try {
      await this.db.execute(
        `INSERT INTO auditlog (shopId, actorUserId, action, entityType, entityId, \`before\`, \`after\`, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actor.shopId,
          actor.actorUserId,
          entry.action,
          entry.entityType,
          entry.entityId ?? null,
          toJson(entry.before),
          toJson(entry.after),
          toJson(entry.metadata),
        ],
      );
    } catch {
      // See comment above — never propagate.
    }
  }

  async logCtx(ctx: TenantContext, entry: LogEntry) {
    await this.log({ shopId: ctx.shopId, actorUserId: ctx.userId }, entry);
  }

  async list(ctx: TenantContext, query: ListAuditLogQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const conditions = ['al.shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (query.entityType) {
      conditions.push('al.entityType = ?');
      params.push(query.entityType);
    }
    if (query.actorUserId) {
      conditions.push('al.actorUserId = ?');
      params.push(query.actorUserId);
    }
    const whereClause = conditions.join(' AND ');

    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM auditlog al WHERE ${whereClause}`,
      params,
    );
    const total = Number(countRows[0].c);

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT al.id, al.action, al.entityType, al.entityId, al.\`before\`, al.\`after\`,
              al.metadata, al.createdAt, u.id AS actorId, u.name AS actorName
       FROM auditlog al
       JOIN user u ON u.id = al.actorUserId
       WHERE ${whereClause}
       ORDER BY al.createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return {
      data: rows.map((r) => ({
        id: r.id as number,
        action: r.action as string,
        entityType: r.entityType as string,
        entityId: r.entityId as number | null,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
        actorId: r.actorId as number,
        actorName: r.actorName as string,
        createdAt: r.createdAt as Date,
      })),
      total,
      page,
      pageSize,
    };
  }

  // Ascending (oldest first) — unlike list() above, this backs a timeline
  // (OrdersService.getHistory), not a most-recent-first activity feed.
  async listForEntity(
    ctx: TenantContext,
    entityType: string,
    entityId: number,
    action?: string,
  ) {
    const conditions = ['al.shopId = ?', 'al.entityType = ?', 'al.entityId = ?'];
    const params: (string | number)[] = [ctx.shopId, entityType, entityId];
    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT al.id, al.action, al.\`before\`, al.\`after\`, al.createdAt, u.name AS actorName
       FROM auditlog al
       JOIN user u ON u.id = al.actorUserId
       WHERE ${conditions.join(' AND ')}
       ORDER BY al.createdAt ASC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as number,
      action: r.action as string,
      before: r.before,
      after: r.after,
      actorName: r.actorName as string,
      createdAt: r.createdAt as Date,
    }));
  }

  // For filter dropdowns — every distinct staff member who has at least one
  // logged action in this shop.
  async listActors(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT al.actorUserId AS id, u.name AS name
       FROM auditlog al
       JOIN user u ON u.id = al.actorUserId
       WHERE al.shopId = ?
       ORDER BY al.actorUserId ASC`,
      [ctx.shopId],
    );
    return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
  }
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
