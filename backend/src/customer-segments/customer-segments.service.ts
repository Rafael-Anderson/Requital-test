import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { compileRules, parseRules, type RuleNode } from './segment-rules';
import { loadSegmentPredicate } from './segment-store';
import type { PreviewSegmentDto, SaveSegmentDto } from './dto/segment.dto';

@Injectable()
export class CustomerSegmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, rules, createdAt, updatedAt FROM customersegment WHERE shopId = ? ORDER BY name`,
      [ctx.shopId],
    );
    return rows.map((r) => this.shape(r));
  }

  async get(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, name, rules, createdAt, updatedAt FROM customersegment WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException(`Segment ${id} not found`);
    return this.shape(rows[0]);
  }

  async create(ctx: TenantContext, dto: SaveSegmentDto) {
    const rules = parseRules(dto.rules);
    try {
      const res = await this.db.execute(
        `INSERT INTO customersegment (shopId, name, rules, createdByUserId) VALUES (?, ?, ?, ?)`,
        [ctx.shopId, dto.name.trim(), JSON.stringify(rules), ctx.userId],
      );
      await this.auditLog.logCtx(ctx, {
        action: 'customer.segment.created',
        entityType: 'customersegment',
        entityId: res.insertId,
        after: { name: dto.name.trim() },
      });
      return this.get(ctx, res.insertId);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A segment with this name already exists');
      }
      throw error;
    }
  }

  async update(ctx: TenantContext, id: number, dto: SaveSegmentDto) {
    const rules = parseRules(dto.rules);
    try {
      const res = await this.db.execute(
        `UPDATE customersegment SET name = ?, rules = ?, updatedAt = CURRENT_TIMESTAMP(3) WHERE id = ? AND shopId = ?`,
        [dto.name.trim(), JSON.stringify(rules), id, ctx.shopId],
      );
      // affectedRows counts matched rows here (mysql2 reports CHANGED rows, so an
      // identical resave would read 0): the existence check is the 404.
      if (res.affectedRows === 0) await this.get(ctx, id);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A segment with this name already exists');
      }
      throw error;
    }
    await this.auditLog.logCtx(ctx, {
      action: 'customer.segment.updated',
      entityType: 'customersegment',
      entityId: id,
    });
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: number) {
    const res = await this.db.execute(
      `DELETE FROM customersegment WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (res.affectedRows === 0) throw new NotFoundException(`Segment ${id} not found`);
    await this.auditLog.logCtx(ctx, {
      action: 'customer.segment.deleted',
      entityType: 'customersegment',
      entityId: id,
    });
    return { deleted: true };
  }

  // Count for an UNSAVED rule tree (the builder's live preview).
  async preview(ctx: TenantContext, dto: PreviewSegmentDto) {
    const predicate = compileRules(parseRules(dto.rules));
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM customer c WHERE c.shopId = ? AND ${predicate.sql}`,
      [ctx.shopId, ...predicate.params],
    );
    return { count: Number(rows[0].n) };
  }

  // Used by the customer list and the export: the predicate of a saved segment.
  predicateFor(shopId: number, segmentId: number) {
    return loadSegmentPredicate(this.db, shopId, segmentId);
  }

  private shape(r: RowDataPacket) {
    const rules: unknown =
      typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules;
    return {
      id: r.id as number,
      name: r.name as string,
      rules: rules as RuleNode,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    };
  }
}
