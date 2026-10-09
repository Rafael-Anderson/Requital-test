import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { assertCustomerInShop } from './customer-scope';
import type { CreateCustomerNoteDto } from './dto/crm.dto';

// CUS-3. Staff-authored notes on a customer. They are internal: no storefront or
// customer-account route reads this table, and the customer's PDPL export does
// not include them (they are the merchant's own working notes, not data the
// customer supplied), but anonymising the customer DELETES them, because free
// text written about a person routinely contains the very details the
// anonymisation exists to remove. The audit entries never carry the note body.
@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(ctx: TenantContext, customerId: number) {
    await assertCustomerInShop(this.db, ctx.shopId, customerId);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, authorUserId, authorName, body, createdAt
         FROM customernote
        WHERE customerId = ? AND shopId = ?
        ORDER BY createdAt DESC, id DESC
        LIMIT 200`,
      [customerId, ctx.shopId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      authorUserId: (r.authorUserId as number | null) ?? null,
      authorName: r.authorName as string,
      body: r.body as string,
      createdAt: r.createdAt as Date,
    }));
  }

  async create(ctx: TenantContext, customerId: number, dto: CreateCustomerNoteDto) {
    await assertCustomerInShop(this.db, ctx.shopId, customerId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('A note cannot be empty');
    const userRows = await this.db.query<RowDataPacket[]>(
      `SELECT name FROM user WHERE id = ? AND shopId = ?`,
      [ctx.userId, ctx.shopId],
    );
    // Author name is a snapshot: the user row can be deleted later and the note
    // must still say who wrote it.
    const authorName = (userRows[0]?.name as string | undefined) ?? 'Staff';
    const res = await this.db.execute(
      `INSERT INTO customernote (shopId, customerId, authorUserId, authorName, body)
       VALUES (?, ?, ?, ?, ?)`,
      [ctx.shopId, customerId, ctx.userId, authorName, body],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'customer.note.created',
      entityType: 'customer',
      entityId: customerId,
      metadata: { noteId: res.insertId },
    });
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, authorUserId, authorName, body, createdAt FROM customernote WHERE id = ?`,
      [res.insertId],
    );
    return rows[0];
  }

  async remove(ctx: TenantContext, customerId: number, noteId: number) {
    // One statement keyed on all three ids: a note that belongs to another
    // customer or shop matches nothing and is a 404.
    const res = await this.db.execute(
      `DELETE FROM customernote WHERE id = ? AND customerId = ? AND shopId = ?`,
      [noteId, customerId, ctx.shopId],
    );
    if (res.affectedRows === 0) {
      throw new NotFoundException(`Note ${noteId} not found`);
    }
    await this.auditLog.logCtx(ctx, {
      action: 'customer.note.deleted',
      entityType: 'customer',
      entityId: customerId,
      metadata: { noteId },
    });
    return { deleted: true };
  }
}
