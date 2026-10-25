import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { FeaturesService } from '../features/features.service';
import type { SubscriptioneventRow } from '../db/types';
import { currentUsagePeriod, usageLevel } from './usage-period';

// PLT-1 first slice: READ ONLY. Nothing in this service writes a plan or a
// subscription, there is no Stripe call and no charge. Every query is scoped by
// the shopId the caller derived (the authenticated user's shop for /billing/*,
// the :shopId path of a platform-admin route for the platform views).
//
// Nothing in order creation reads or imports this module (the soft ceiling is
// messaging only, section 8.3); test/billing-plt1.e2e-spec.ts and
// tools/check-billing-isolation.js (CI `guardrails`) pin that.
@Injectable()
export class BillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
  ) {}

  // The shop's current subscription joined to its plan. `hasSubscription: false`
  // means no row (fail-open: every feature is available, the shop is never
  // dunned); the plan fields are then null rather than invented.
  async getSubscription(shopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT ss.status, ss.source, ss.currency, ss.billingInterval,
              ss.trialStartedAt, ss.trialEndsAt, ss.currentPeriodStart,
              ss.currentPeriodEnd, ss.cancelAtPeriodEnd, ss.cancelledAt,
              p.code AS planCode, p.name AS planName, p.kind AS planKind,
              p.orderSoftCeiling
         FROM shopsubscription ss
         JOIN plan p ON p.id = ss.planId
        WHERE ss.shopId = ?`,
      [shopId],
    );
    const r = rows[0];
    return {
      hasSubscription: !!r,
      status: (r?.status as string | undefined) ?? null,
      source: (r?.source as string | undefined) ?? null,
      plan: r
        ? {
            code: r.planCode as string,
            name: r.planName as string,
            kind: r.planKind as string,
            orderSoftCeiling: (r.orderSoftCeiling as number | null) ?? null,
          }
        : null,
      currency: (r?.currency as string | null | undefined) ?? null,
      billingInterval: (r?.billingInterval as string | null | undefined) ?? null,
      trialEndsAt: (r?.trialEndsAt as Date | null | undefined) ?? null,
      currentPeriodEnd: (r?.currentPeriodEnd as Date | null | undefined) ?? null,
      cancelAtPeriodEnd: r ? Boolean(r.cancelAtPeriodEnd) : false,
      // What the plan entitles, key and description only. Never the merchant's
      // own switch values or any platform override.
      features: ((await this.features.describe(shopId)) ?? []).map((f) => ({
        key: f.key,
        description: f.description,
        entitled: f.entitled,
      })),
    };
  }

  // Live, indexed COUNT (Order_shopId_createdAt_idx) of this shop's non-cancelled
  // orders in the current calendar month of the shop's timezone. Never cached,
  // never written to order creation.
  async getUsage(shopId: number, now: Date = new Date()) {
    const [shop, plan] = await Promise.all([
      this.db.query<RowDataPacket[]>(`SELECT timezone FROM shop WHERE id = ?`, [shopId]),
      this.db.query<RowDataPacket[]>(
        `SELECT p.orderSoftCeiling
           FROM shopsubscription ss JOIN plan p ON p.id = ss.planId
          WHERE ss.shopId = ?`,
        [shopId],
      ),
    ]);
    if (!shop[0]) throw new NotFoundException('Shop not found');
    const period = currentUsagePeriod(now, shop[0].timezone as string);
    const counted = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM \`order\`
        WHERE shopId = ? AND createdAt >= ? AND createdAt < ? AND status <> 'cancelled'`,
      [shopId, period.start, period.endExclusive],
    );
    const used = Number(counted[0].n);
    const ceiling = (plan[0]?.orderSoftCeiling as number | null | undefined) ?? null;
    return {
      periodKey: period.periodKey,
      used,
      ceiling,
      percent: ceiling ? Math.floor((used / ceiling) * 100) : null,
      level: usageLevel(used, ceiling),
    };
  }

  // Platform-admin view of one shop's billing. Reads only.
  async getShopBilling(shopId: number) {
    const shop = await this.db.query<RowDataPacket[]>(
      `SELECT id, suspendedAt, suspensionReason FROM shop WHERE id = ?`,
      [shopId],
    );
    if (!shop[0]) throw new NotFoundException(`Shop ${shopId} not found`);
    const [subscription, usage, events] = await Promise.all([
      this.getSubscription(shopId),
      this.getUsage(shopId),
      this.db.query<(SubscriptioneventRow & RowDataPacket)[]>(
        `SELECT e.id, e.fromStatus, e.toStatus, e.reason, e.actorType, e.actorId,
                e.createdAt, fp.code AS fromPlanCode, tp.code AS toPlanCode
           FROM subscriptionevent e
           LEFT JOIN plan fp ON fp.id = e.fromPlanId
           JOIN plan tp ON tp.id = e.toPlanId
          WHERE e.shopId = ?
          ORDER BY e.createdAt DESC, e.id DESC
          LIMIT 20`,
        [shopId],
      ),
    ]);
    return {
      subscription,
      usage,
      suspension: {
        suspendedAt: (shop[0].suspendedAt as Date | null) ?? null,
        reason: (shop[0].suspensionReason as string | null) ?? null,
      },
      events,
    };
  }

  // Shops the fail-open rule is currently covering (section 5.2), newest first
  // (the recent ones are the anomalies). Capped list plus the real total.
  async listShopsWithoutSubscription() {
    const [rows, total] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT s.id, s.name, s.subdomain, s.createdAt
           FROM shop s
           LEFT JOIN shopsubscription ss ON ss.shopId = s.id
          WHERE ss.shopId IS NULL
          ORDER BY s.id DESC
          LIMIT 100`,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM shop s
           LEFT JOIN shopsubscription ss ON ss.shopId = s.id
          WHERE ss.shopId IS NULL`,
      ),
    ]);
    return { total: Number(total[0].n), data: rows };
  }
}
