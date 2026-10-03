import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { publicReviewComment, publicReviewerName } from './review-display';

// The one definition of "may be shown to shoppers", used by the toggle's
// atomic UPDATE and by the public read, so a row can never be served on a
// weaker rule than it could be featured on:
//   - the customer ticked the publish box (publishConsent = 1; NULL is unknown
//     and never counts),
//   - they actually answered, with a rating,
//   - and left a non-empty comment.
const ELIGIBLE_SQL = `s.publishConsent = 1 AND s.respondedAt IS NOT NULL
  AND s.rating IS NOT NULL AND s.comment IS NOT NULL
  AND CHAR_LENGTH(TRIM(s.comment)) > 0`;

export interface AdminReview {
  id: number;
  orderNumber: number;
  customerName: string;
  rating: number | null;
  comment: string | null;
  respondedAt: Date;
  publishConsent: number | null;
  featuredAt: Date | null;
  canFeature: boolean;
}

export interface PublicReview {
  name: string;
  rating: number;
  comment: string;
  date: Date;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(ctx: TenantContext, query: ListReviewsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const [rows, totals] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT s.id, o.shopOrderNumber, o.customerName, s.rating, s.comment,
                s.respondedAt, s.publishConsent, s.featuredAt
           FROM surveyresponse s
           JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
          WHERE s.shopId = ? AND s.respondedAt IS NOT NULL
          ORDER BY s.respondedAt DESC, s.id DESC
          LIMIT ? OFFSET ?`,
        [ctx.shopId, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM surveyresponse
          WHERE shopId = ? AND respondedAt IS NOT NULL`,
        [ctx.shopId],
      ),
    ]);
    const data: AdminReview[] = rows.map((r) => {
      const consent =
        r.publishConsent == null ? null : Number(r.publishConsent);
      const comment = (r.comment as string | null) ?? null;
      return {
        id: r.id as number,
        orderNumber: r.shopOrderNumber as number,
        customerName: r.customerName as string,
        rating: r.rating as number | null,
        comment,
        respondedAt: r.respondedAt as Date,
        publishConsent: consent,
        featuredAt: (r.featuredAt as Date | null) ?? null,
        canFeature: consent === 1 && (comment ?? '').trim().length > 0,
      };
    });
    return { data, page, pageSize, total: Number(totals[0].total) };
  }

  // Featuring is one conditional UPDATE: the consent and comment rules sit in
  // its WHERE clause, so there is no read-then-write window in which a row
  // that stopped being eligible could still be switched on. Unfeaturing is
  // always allowed. Every statement carries shopId, so another shop's id is a
  // 404, never a write.
  async setFeatured(ctx: TenantContext, id: number, featured: boolean) {
    const existing = await this.db.query<RowDataPacket[]>(
      `SELECT id, featuredAt FROM surveyresponse WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (!existing[0]) throw new NotFoundException('Review not found');

    if (featured) {
      await this.db.execute(
        `UPDATE surveyresponse s
            SET s.featuredAt = COALESCE(s.featuredAt, NOW(3))
          WHERE s.id = ? AND s.shopId = ? AND ${ELIGIBLE_SQL}`,
        [id, ctx.shopId],
      );
    } else {
      await this.db.execute(
        `UPDATE surveyresponse SET featuredAt = NULL WHERE id = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
    }

    const after = await this.db.query<RowDataPacket[]>(
      `SELECT featuredAt FROM surveyresponse WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const isFeatured = after[0]?.featuredAt != null;
    if (featured && !isFeatured) {
      throw new ConflictException(
        'This review cannot be shown: the customer did not agree to publish it, or it has no comment.',
      );
    }
    if (isFeatured !== (existing[0].featuredAt != null)) {
      await this.auditLogService.logCtx(ctx, {
        action: isFeatured ? 'review.featured' : 'review.unfeatured',
        entityType: 'surveyresponse',
        entityId: id,
      });
    }
    return { id, featured: isFeatured };
  }

  // Public read. The caller (PublicService) has already resolved the shop
  // through its choke point; this only ever filters by that shop's id and
  // returns the four fields a shopper may see, never an id or contact detail.
  async listFeatured(
    shopId: number,
    opts: { limit?: number; minRating?: number },
  ): Promise<PublicReview[]> {
    const limit = Math.min(Math.max(opts.limit ?? 12, 1), 12);
    const params: (number | string)[] = [shopId];
    let ratingSql = '';
    if (opts.minRating) {
      ratingSql = 'AND s.rating >= ?';
      params.push(opts.minRating);
    }
    params.push(limit);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.customerName, s.rating, s.comment, s.respondedAt
         FROM surveyresponse s
         JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
        WHERE s.shopId = ? AND s.featuredAt IS NOT NULL AND ${ELIGIBLE_SQL}
          ${ratingSql}
        ORDER BY s.respondedAt DESC, s.id DESC
        LIMIT ?`,
      params,
    );
    return rows.map((r) => ({
      name: publicReviewerName(r.customerName as string),
      rating: r.rating as number,
      comment: publicReviewComment(r.comment as string),
      date: r.respondedAt as Date,
    }));
  }
}
