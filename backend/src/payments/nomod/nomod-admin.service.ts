import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import type { TenantContext } from '../../common/tenant-context';
import { minorToDecimal } from '../../drivers/cash';
import type { NomodcheckoutRow } from '../../db/types';
import { PaymentSettingsService } from '../payment-settings.service';
import { NomodClient, NomodConfigError } from './nomod-client';
import { nomodCredentials } from './nomod-payment.service';
import { NomodConfirmService } from './nomod-confirm.service';

export interface NomodPendingRow {
  id: number;
  orderId: number;
  shopOrderNumber: number;
  status: string;
  reviewReason: string | null;
  disputed: boolean;
  amount: string;
  currency: string;
  createdAt: Date;
  lastCheckedAt: Date | null;
}

@Injectable()
export class NomodAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: PaymentSettingsService,
    private readonly client: NomodClient,
    private readonly confirm: NomodConfirmService,
  ) {}

  async webhookPath(ctx: TenantContext): Promise<{ webhookPath: string }> {
    const token = await this.settings.ensureNomodWebhookToken(ctx.shopId);
    return { webhookPath: `/payments/webhook/nomod/${token}` };
  }

  // The old URL stops working immediately; the merchant pastes the new one into Nomod.
  async rotateWebhookPath(
    ctx: TenantContext,
  ): Promise<{ webhookPath: string }> {
    const token = await this.settings.rotateNomodWebhookToken(ctx.shopId);
    return { webhookPath: `/payments/webhook/nomod/${token}` };
  }

  // A harmless authenticated read with the SAVED key. The key never appears in the
  // answer; a failure is a fixed sentence.
  async testConnection(
    ctx: TenantContext,
  ): Promise<{ ok: boolean; message: string }> {
    const creds = nomodCredentials(
      await this.settings.resolveCredentials(ctx.shopId, 'nomod'),
    );
    if (!creds) {
      return { ok: false, message: 'Save a Nomod API key first.' };
    }
    try {
      return await this.client.testConnection(creds);
    } catch (err) {
      if (err instanceof NomodConfigError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: 'Could not reach Nomod.' };
    }
  }

  // Nomod checkouts still unpaid after `minutes`, plus every one parked for review
  // and every disputed one. Shop-scoped.
  async listPending(
    ctx: TenantContext,
    minutes: number,
  ): Promise<NomodPendingRow[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT c.id, c.orderId, o.shopOrderNumber, c.status, c.reviewReason, c.disputedAt,
              c.amountMinor, c.currency, c.createdAt, c.lastCheckedAt
         FROM nomodcheckout c JOIN \`order\` o ON o.id = c.orderId AND o.shopId = c.shopId
        WHERE c.shopId = ?
          AND ((o.paymentStatus = 'unpaid' AND o.status <> 'cancelled'
                AND c.status IN ('created', 'creating')
                AND c.createdAt < NOW() - INTERVAL ? MINUTE)
               OR c.status = 'review' OR c.disputedAt IS NOT NULL)
        ORDER BY c.createdAt DESC LIMIT 100`,
      [ctx.shopId, minutes],
    );
    return rows.map((r) => ({
      id: r.id as number,
      orderId: r.orderId as number,
      shopOrderNumber: r.shopOrderNumber as number,
      status: r.status as string,
      reviewReason: (r.reviewReason as string | null) ?? null,
      disputed: r.disputedAt !== null,
      amount: minorToDecimal(Number(r.amountMinor), r.currency as string),
      currency: r.currency as string,
      createdAt: r.createdAt as Date,
      lastCheckedAt: (r.lastCheckedAt as Date | null) ?? null,
    }));
  }

  // Re-asks Nomod about one checkout of THIS shop.
  async recheck(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(NomodcheckoutRow & RowDataPacket)[]>(
      `SELECT * FROM nomodcheckout WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (!rows[0]) throw new NotFoundException('Nomod checkout not found');
    // A parked row is checked again too: the merchant asked.
    if (rows[0].status === 'review') {
      await this.db.execute(
        `UPDATE nomodcheckout SET status = 'created', reviewReason = NULL WHERE id = ? AND shopId = ? AND status = 'review'`,
        [id, ctx.shopId],
      );
      rows[0].status = 'created';
    }
    const outcome = await this.confirm.confirmCheckout(rows[0]);
    return { outcome };
  }
}
