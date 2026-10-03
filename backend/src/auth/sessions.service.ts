import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';

// STF-4. A session is a refresh-token family (see AuthService.issueTokenPair);
// its id is the familyId. No token or token hash is ever selected here, so none
// can be returned.
@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Own sessions; an admin may list another user's of the SAME shop. The
  // shop check is on the user row (a refreshtoken has no shopId of its own).
  async list(ctx: TenantContext, userId?: number) {
    const target = userId ?? ctx.userId;
    if (target !== ctx.userId) {
      if (ctx.role !== 'admin') {
        throw new ForbiddenException(
          "Only an admin can view another user's sessions",
        );
      }
      await this.assertUserInShop(ctx, target);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT r.familyId AS id, r.userAgent, r.ip, r.createdAt AS lastActiveAt,
              (SELECT MIN(r2.createdAt) FROM refreshtoken r2
                WHERE r2.familyId = r.familyId) AS startedAt
       FROM refreshtoken r
       JOIN user u ON u.id = r.userId AND u.shopId = ?
       WHERE r.userId = ? AND r.revokedAt IS NULL AND r.expiresAt > ?
       ORDER BY r.createdAt DESC`,
      [ctx.shopId, target, new Date()],
    );
    return rows.map((r) => ({
      id: r.id as string,
      userAgent: r.userAgent as string | null,
      ip: r.ip as string | null,
      startedAt: r.startedAt as Date,
      // The session's newest refresh row: access tokens last 15 minutes, so
      // this is "last active" to within about that.
      lastActiveAt: r.lastActiveAt as Date,
      current: target === ctx.userId && r.id === ctx.sessionId,
    }));
  }

  // Own session, or (admin) any session of a user in the same shop. One
  // statement, so "not yours / other shop / already gone" are all the same 404.
  async revoke(ctx: TenantContext, sessionId: string) {
    this.assertNotImpersonating(ctx);
    const result = await this.db.execute(
      `UPDATE refreshtoken r JOIN user u ON u.id = r.userId
       SET r.revokedAt = ?
       WHERE r.familyId = ? AND r.revokedAt IS NULL AND u.shopId = ?
         AND (u.id = ? OR ? = 'admin')`,
      [new Date(), sessionId, ctx.shopId, ctx.userId, ctx.role],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException('Session not found');
    }
    await this.auditLog.logCtx(ctx, {
      action: 'auth.session_revoked',
      entityType: 'auth',
      entityId: ctx.userId,
      metadata: { sessionId },
    });
    return { success: true };
  }

  // Everything except the session making this request.
  async revokeOthers(ctx: TenantContext) {
    this.assertNotImpersonating(ctx);
    const result = await this.db.execute(
      `UPDATE refreshtoken SET revokedAt = ?
       WHERE userId = ? AND revokedAt IS NULL AND familyId <> ?`,
      [new Date(), ctx.userId, ctx.sessionId ?? ''],
    );
    await this.auditLog.logCtx(ctx, {
      action: 'auth.sessions_revoked_others',
      entityType: 'auth',
      entityId: ctx.userId,
    });
    return { success: true, revoked: result.affectedRows };
  }

  // An impersonation token has no session of its own, so "all others" would
  // mean every real session of the shop admin being impersonated.
  private assertNotImpersonating(ctx: TenantContext) {
    if (ctx.impersonatedByPlatformAdminId !== undefined) {
      throw new ForbiddenException('Not available while impersonating');
    }
  }

  private async assertUserInShop(ctx: TenantContext, userId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE id = ? AND shopId = ?`,
      [userId, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException('User not found');
  }
}
