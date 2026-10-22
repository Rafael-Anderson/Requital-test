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
  async log(
    actor: { shopId: number; actorUserId: number | null; actorLabel?: string },
    entry: LogEntry,
  ) {
    try {
      await this.db.execute(
        `INSERT INTO auditlog (shopId, actorUserId, actorLabel, action, entityType, entityId, \`before\`, \`after\`, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actor.shopId,
          actor.actorUserId,
          actor.actorLabel ?? null,
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
    // A delivery-run driver has no user row: attribute by label, never by a
    // borrowed staff id.
    if (ctx.driver) {
      await this.log(
        {
          shopId: ctx.shopId,
          actorUserId: null,
          actorLabel: `driver ${ctx.driver.name}`,
        },
        entry,
      );
      return;
    }
    if (ctx.systemActorLabel) {
      await this.log(
        {
          shopId: ctx.shopId,
          actorUserId: null,
          actorLabel: ctx.systemActorLabel,
        },
        entry,
      );
      return;
    }
    await this.log(
      {
        shopId: ctx.shopId,
        actorUserId: ctx.userId,
        actorLabel: staffActorLabel(ctx),
      },
      entry,
    );
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
    if (query.actorLabel) {
      // A system, driver or marketplace actor has no user row: filter by label.
      conditions.push('al.actorUserId IS NULL AND al.actorLabel = ?');
      params.push(query.actorLabel);
    }
    const whereClause = conditions.join(' AND ');

    const countRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM auditlog al WHERE ${whereClause}`,
      params,
    );
    const total = Number(countRows[0].c);

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT al.id, al.action, al.entityType, al.entityId, al.\`before\`, al.\`after\`,
              al.metadata, al.createdAt, u.id AS actorId,
              COALESCE(al.actorLabel, u.name) AS actorName
       FROM auditlog al
       LEFT JOIN user u ON u.id = al.actorUserId
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
        actorId: r.actorId as number | null,
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
    action?: string | string[],
  ) {
    const conditions = ['al.shopId = ?', 'al.entityType = ?', 'al.entityId = ?'];
    const params: (string | number)[] = [ctx.shopId, entityType, entityId];
    if (Array.isArray(action)) {
      conditions.push(`al.action IN (${action.map(() => '?').join(', ')})`);
      params.push(...action);
    } else if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT al.id, al.action, al.\`before\`, al.\`after\`, al.createdAt,
              COALESCE(al.actorLabel, u.name) AS actorName
       FROM auditlog al
       LEFT JOIN user u ON u.id = al.actorUserId
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

  // For filter dropdowns: every staff member who has at least one logged action
  // in this shop (id set), then every label-only actor such as "driver Ahmed" or
  // "system (payment gateway)" (id null, filtered by label).
  async listActors(ctx: TenantContext) {
    const staff = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT al.actorUserId AS id, u.name AS name
       FROM auditlog al
       JOIN user u ON u.id = al.actorUserId
       WHERE al.shopId = ?
       ORDER BY al.actorUserId ASC`,
      [ctx.shopId],
    );
    const labels = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT al.actorLabel AS name
       FROM auditlog al
       WHERE al.shopId = ? AND al.actorUserId IS NULL AND al.actorLabel IS NOT NULL
       ORDER BY al.actorLabel ASC`,
      [ctx.shopId],
    );
    return [
      ...staff.map((r) => ({ id: r.id as number | null, name: r.name as string })),
      ...labels.map((r) => ({ id: null as number | null, name: r.name as string })),
    ];
  }
}

// The label snapshotted with a staff action (auditlog.actorLabel is VARCHAR(191)).
// An impersonated session is Requital staff acting as that user.
function staffActorLabel(ctx: TenantContext): string | undefined {
  if (!ctx.userName) return undefined;
  const label =
    ctx.impersonatedByPlatformAdminId !== undefined
      ? `Requital support (impersonating ${ctx.userName})`
      : ctx.userName;
  return label.slice(0, 191);
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
