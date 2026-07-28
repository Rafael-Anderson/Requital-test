import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
      await this.prisma.auditlog.create({
        data: {
          shopId: actor.shopId,
          actorUserId: actor.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: toJson(entry.before),
          after: toJson(entry.after),
          metadata: toJson(entry.metadata),
        },
      });
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
    const where: Prisma.auditlogWhereInput = {
      shopId: ctx.shopId,
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.auditlog.count({ where }),
      this.prisma.auditlog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
        actorId: r.actor.id,
        actorName: r.actor.name,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  // For filter dropdowns — every distinct staff member who has at least one
  // logged action in this shop.
  async listActors(ctx: TenantContext) {
    const rows = await this.prisma.auditlog.findMany({
      where: { shopId: ctx.shopId },
      distinct: ['actorUserId'],
      select: { actor: { select: { id: true, name: true } } },
      orderBy: { actorUserId: 'asc' },
    });
    return rows.map((r) => r.actor);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
