import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../database/database.service';
import type { NewslettersubscriberRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import type { ListNewsletterSubscribersQueryDto } from './dto/list-newsletter-subscribers-query.dto';

// The read side of the storefront newsletter widget. Rows are written by
// PublicService.subscribeNewsletter (POST /public/:shopSlug/
// newsletter-subscribe) and, until this existed, were never read by anything
// — collected and unusable.
//
// Shop-scoped, not outlet-scoped: `newslettersubscriber` has no outletId and
// the widget has no outlet context, so there is nothing to scope by beyond
// shopId (which every query here filters on).
@Injectable()
export class NewsletterService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(ctx: TenantContext, query: ListNewsletterSubscribersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const searchCondition = search ? 'AND email LIKE ?' : '';
    const searchParams = search ? [`%${search}%`] : [];

    const rows = await this.db.query<(NewslettersubscriberRow & RowDataPacket)[]>(
      `SELECT id, email, source, createdAt
         FROM newslettersubscriber
        WHERE shopId = ? ${searchCondition}
        ORDER BY createdAt DESC, id DESC
        LIMIT ? OFFSET ?`,
      [ctx.shopId, ...searchParams, pageSize, (page - 1) * pageSize],
    );

    const totalRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM newslettersubscriber
        WHERE shopId = ? ${searchCondition}`,
      [ctx.shopId, ...searchParams],
    );

    return {
      data: rows.map((r) => ({
        id: r.id,
        email: r.email,
        source: r.source,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].total),
    };
  }
}
