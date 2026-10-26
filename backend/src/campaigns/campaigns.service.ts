import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FeaturesService } from '../features/features.service';
import { JobsService } from '../jobs/jobs.service';
import { SendingDomainsService } from '../sending-domains/sending-domains.service';
import { loadSegmentPredicate } from '../customer-segments/segment-store';
import { sanitizeHtml } from '../common/sanitize-html';
import { sendEmailOrThrow } from '../common/email';
import { storefrontUrl } from '../common/storefront-url';
import type { TenantContext } from '../common/tenant-context';
import type { CampaignRow } from '../db/types';
import type { CompiledPredicate } from '../customer-segments/segment-rules';
import { audienceSql } from './campaign-audience';
import {
  htmlToText,
  renderCampaignEmail,
  unsubscribeHeaders,
} from './campaign-email';
import type { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

// Per shop, rolling 24 hours. Campaign mail only: transactional mail neither counts
// toward it nor waits on it.
export function dailySendCap(): number {
  const n = Number(process.env.CAMPAIGN_DAILY_SEND_CAP);
  return Number.isInteger(n) && n > 0 ? n : 500;
}

type CampaignDb = CampaignRow & RowDataPacket;

const NOT_ENABLED = 'Email campaigns are not enabled for this shop';
const NEEDS_DOMAIN =
  'Campaigns are sent from your own verified sending domain. Verify one in Settings first.';
// A placeholder that matches no stored token: a test send's unsubscribe link opens
// the real page and finds nothing, so a test can never unsubscribe anyone.
const TEST_TOKEN = '0'.repeat(32);

@Injectable()
export class CampaignsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditLogService,
    private readonly features: FeaturesService,
    private readonly jobs: JobsService,
    private readonly sendingDomains: SendingDomainsService,
  ) {}

  private async assertEnabled(shopId: number) {
    if (!(await this.features.isEnabled(shopId, 'email_campaigns'))) {
      throw new ForbiddenException(NOT_ENABLED);
    }
  }

  private async load(shopId: number, id: number): Promise<CampaignDb> {
    const rows = await this.db.query<CampaignDb[]>(
      `SELECT * FROM campaign WHERE id = ? AND shopId = ?`,
      [id, shopId],
    );
    if (rows.length === 0) throw new NotFoundException('Campaign not found');
    return rows[0];
  }

  private async counts(shopId: number, ids: number[]) {
    const out = new Map<number, Record<string, number>>();
    if (ids.length === 0) return out;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT campaignId, status, COUNT(*) AS n FROM campaignrecipient
        WHERE shopId = ? AND campaignId IN (${ids.map(() => '?').join(',')})
        GROUP BY campaignId, status`,
      [shopId, ...ids],
    );
    for (const r of rows) {
      const m = out.get(r.campaignId as number) ?? {};
      m[r.status as string] = Number(r.n);
      out.set(r.campaignId as number, m);
    }
    return out;
  }

  private view(c: CampaignDb, counts: Record<string, number> = {}, withBody = false) {
    return {
      id: c.id,
      name: c.name,
      subject: c.subject,
      ...(withBody ? { bodyHtml: c.bodyHtml } : {}),
      segmentId: c.segmentId,
      status: c.status,
      audienceCount: c.audienceCount,
      failureReason: c.failureReason,
      sendingStartedAt: c.sendingStartedAt,
      completedAt: c.completedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      counts: {
        pending: counts.pending ?? 0,
        sent: counts.sent ?? 0,
        skipped: counts.skipped ?? 0,
        failed: counts.failed ?? 0,
      },
    };
  }

  // What the admin page needs before it can offer anything.
  async status(ctx: TenantContext) {
    const enabled = await this.features.isEnabled(ctx.shopId, 'email_campaigns');
    const identity = await this.sendingDomains.resolveIdentity(ctx.shopId);
    const sent = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM campaignrecipient
        WHERE shopId = ? AND status = 'sent' AND sentAt >= ?`,
      [ctx.shopId, new Date(Date.now() - 24 * 3600_000)],
    );
    return {
      enabled,
      sendingDomainVerified: identity !== null,
      fromAddress: identity?.fromAddress ?? null,
      dailyCap: dailySendCap(),
      sentLast24Hours: Number(sent[0].n),
    };
  }

  async list(ctx: TenantContext) {
    await this.assertEnabled(ctx.shopId);
    const rows = await this.db.query<CampaignDb[]>(
      `SELECT id, shopId, name, subject, segmentId, status, audienceCount, failureReason,
              createdBy, sendingStartedAt, completedAt, createdAt, updatedAt
         FROM campaign WHERE shopId = ? ORDER BY createdAt DESC, id DESC LIMIT 200`,
      [ctx.shopId],
    );
    const counts = await this.counts(ctx.shopId, rows.map((r) => r.id));
    return rows.map((r) => this.view(r, counts.get(r.id)));
  }

  async get(ctx: TenantContext, id: number) {
    await this.assertEnabled(ctx.shopId);
    const c = await this.load(ctx.shopId, id);
    const counts = await this.counts(ctx.shopId, [id]);
    return this.view(c, counts.get(id), true);
  }

  private cleanBody(raw: string) {
    const { html, removedTags } = sanitizeHtml(raw);
    if (htmlToText(html) === '') {
      throw new BadRequestException('The email body is empty');
    }
    return { html, removedTags };
  }

  // A segment id of another shop (or a missing one) is a 404 here.
  private async assertSegment(shopId: number, segmentId: number | null | undefined) {
    if (segmentId != null) await loadSegmentPredicate(this.db, shopId, segmentId);
  }

  async create(ctx: TenantContext, dto: CreateCampaignDto) {
    await this.assertEnabled(ctx.shopId);
    await this.assertSegment(ctx.shopId, dto.segmentId);
    const { html, removedTags } = this.cleanBody(dto.bodyHtml);
    const res = await this.db.execute(
      `INSERT INTO campaign (shopId, name, subject, bodyHtml, segmentId, createdBy)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.shopId, dto.name, dto.subject, html, dto.segmentId ?? null, ctx.userId],
    );
    await this.audit.logCtx(ctx, {
      action: 'campaign.created',
      entityType: 'campaign',
      entityId: res.insertId,
      after: { name: dto.name },
    });
    return { ...(await this.get(ctx, res.insertId)), removedTags };
  }

  // Drafts only: a campaign that has started sending is a record, not a document.
  async update(ctx: TenantContext, id: number, dto: UpdateCampaignDto) {
    await this.assertEnabled(ctx.shopId);
    const current = await this.load(ctx.shopId, id);
    if (current.status !== 'draft') {
      throw new ConflictException('Only a draft campaign can be edited');
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    let removedTags: string[] = [];
    if (dto.name !== undefined) {
      sets.push('name = ?');
      params.push(dto.name);
    }
    if (dto.subject !== undefined) {
      sets.push('subject = ?');
      params.push(dto.subject);
    }
    if (dto.bodyHtml !== undefined) {
      const cleaned = this.cleanBody(dto.bodyHtml);
      removedTags = cleaned.removedTags;
      sets.push('bodyHtml = ?');
      params.push(cleaned.html);
    }
    if (dto.segmentId !== undefined) {
      await this.assertSegment(ctx.shopId, dto.segmentId);
      sets.push('segmentId = ?');
      params.push(dto.segmentId);
    }
    if (sets.length > 0) {
      const res = await this.db.execute(
        `UPDATE campaign SET ${sets.join(', ')}, updatedAt = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND shopId = ? AND status = 'draft'`,
        [...params, id, ctx.shopId],
      );
      // mysql2 reports CHANGED rows: re-read to tell "unchanged" from "lost the race".
      if (res.affectedRows === 0) {
        const again = await this.load(ctx.shopId, id);
        if (again.status !== 'draft') {
          throw new ConflictException('Only a draft campaign can be edited');
        }
      }
      await this.audit.logCtx(ctx, {
        action: 'campaign.updated',
        entityType: 'campaign',
        entityId: id,
      });
    }
    return { ...(await this.get(ctx, id)), removedTags };
  }

  // COUNTS ONLY. No address ever leaves in a preview.
  async audiencePreview(ctx: TenantContext, id: number) {
    await this.assertEnabled(ctx.shopId);
    const c = await this.load(ctx.shopId, id);
    const segment =
      c.segmentId != null
        ? await loadSegmentPredicate(this.db, ctx.shopId, c.segmentId)
        : null;
    const a = audienceSql(ctx.shopId, segment);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM (${a.sql}) t`,
      a.params,
    );
    return { count: Number(rows[0].n) };
  }

  private async shopFor(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT name, displayName, legalName, address, email, subdomain, domainType,
              customDomain, customDomainStatus
         FROM shop WHERE id = ?`,
      [shopId],
    );
    return rows[0];
  }

  // To the ACTING admin's own address only; there is no recipient parameter.
  async sendTest(ctx: TenantContext, id: number) {
    await this.assertEnabled(ctx.shopId);
    const c = await this.load(ctx.shopId, id);
    if (!(await this.sendingDomains.resolveIdentity(ctx.shopId))) {
      throw new ConflictException(NEEDS_DOMAIN);
    }
    const users = await this.db.query<RowDataPacket[]>(
      `SELECT email, emailVerified FROM user WHERE id = ? AND shopId = ?`,
      [ctx.userId, ctx.shopId],
    );
    const u = users[0];
    if (!u || !u.emailVerified || !u.email) {
      throw new ForbiddenException(
        'Verify your own email address before sending a test.',
      );
    }
    const shop = await this.shopFor(ctx.shopId);
    const shopName = (shop.displayName as string | null) || (shop.name as string);
    const link = storefrontUrl(shop as never, `/unsubscribe?token=${TEST_TOKEN}`);
    const { html, text } = renderCampaignEmail({
      shopName,
      legalName: shop.legalName as string | null,
      address: shop.address as string | null,
      contactEmail: shop.email as string | null,
      bodyHtml: sanitizeHtml(c.bodyHtml).html,
      unsubscribeUrl: link,
    });
    try {
      await sendEmailOrThrow(u.email as string, `[Test] ${c.subject}`, text, {
        html,
        fromName: shopName,
        shopId: ctx.shopId,
        requireShopIdentity: true,
        headers: unsubscribeHeaders(
          storefrontUrl(shop as never, `/api/public/campaigns/unsubscribe?token=${TEST_TOKEN}`),
        ),
      });
    } catch {
      throw new ConflictException(
        'The test email could not be sent. Check your sending domain and try again.',
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'campaign.test_sent',
      entityType: 'campaign',
      entityId: id,
    });
    return { sent: true };
  }

  // Confirm and send. The draft -> sending CAS, the audience snapshot and the
  // first batch job commit together; a second confirm finds the CAS lost and
  // returns the campaign as it is, enqueueing nobody.
  async send(ctx: TenantContext, id: number) {
    await this.assertEnabled(ctx.shopId);
    const c = await this.load(ctx.shopId, id);
    if (c.status !== 'draft') {
      return this.get(ctx, id);
    }
    if (!(await this.sendingDomains.resolveIdentity(ctx.shopId))) {
      throw new ConflictException(NEEDS_DOMAIN);
    }
    let segment: CompiledPredicate | null = null;
    if (c.segmentId != null) {
      try {
        segment = await loadSegmentPredicate(this.db, ctx.shopId, c.segmentId);
      } catch {
        throw new ConflictException('The segment for this campaign no longer exists');
      }
    }
    const a = audienceSql(ctx.shopId, segment);

    const started = await this.db.transaction(async (conn) => {
      const [cas] = await conn.query<ResultSetHeader>(
        `UPDATE campaign SET status = 'sending', sendingStartedAt = ?, updatedAt = ?
          WHERE id = ? AND shopId = ? AND status = 'draft'`,
        [new Date(), new Date(), id, ctx.shopId],
      );
      if (cas.affectedRows === 0) return false;
      const [ins] = await conn.query<ResultSetHeader>(
        `INSERT IGNORE INTO campaignrecipient (campaignId, shopId, email)
         SELECT ?, ?, LOWER(t.email) FROM (${a.sql}) t`,
        [id, ctx.shopId, ...a.params],
      );
      if (ins.affectedRows === 0) {
        // Rolls the CAS back: the campaign stays a draft.
        throw new ConflictException('There is nobody to send this campaign to');
      }
      await conn.query(`UPDATE campaign SET audienceCount = ? WHERE id = ?`, [
        ins.affectedRows,
        id,
      ]);
      await this.jobs.enqueue(
        ctx.shopId,
        'send_campaign_batch',
        { campaignId: id, batch: 0 },
        `campaign:${id}:batch:0`,
        { tx: conn },
      );
      return ins.affectedRows;
    });
    if (started) {
      await this.audit.logCtx(ctx, {
        action: 'campaign.sent',
        entityType: 'campaign',
        entityId: id,
        after: { audience: started },
      });
    }
    return this.get(ctx, id);
  }

  async cancel(ctx: TenantContext, id: number) {
    await this.assertEnabled(ctx.shopId);
    const c = await this.load(ctx.shopId, id);
    if (c.status === 'cancelled') return this.get(ctx, id);
    if (c.status !== 'draft' && c.status !== 'sending') {
      throw new ConflictException('This campaign has already finished');
    }
    const res = await this.db.execute(
      `UPDATE campaign SET status = 'cancelled', completedAt = ?, updatedAt = ?
        WHERE id = ? AND shopId = ? AND status IN ('draft', 'sending')`,
      [new Date(), new Date(), id, ctx.shopId],
    );
    if (res.affectedRows > 0) {
      // Mails already claimed by a running batch are past recall; the rest never go.
      await this.db.execute(
        `UPDATE campaignrecipient SET status = 'skipped', note = 'cancelled'
          WHERE campaignId = ? AND shopId = ? AND status = 'pending' AND claimedAt IS NULL`,
        [id, ctx.shopId],
      );
      await this.audit.logCtx(ctx, {
        action: 'campaign.cancelled',
        entityType: 'campaign',
        entityId: id,
      });
    }
    return this.get(ctx, id);
  }
}
