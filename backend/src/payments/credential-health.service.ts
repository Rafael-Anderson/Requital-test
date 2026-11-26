import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { createLogger } from '../common/logging/logger';
import { NomodApiError } from './nomod/nomod-client';

const logger = createLogger('CredentialHealthService');

// The card processors whose credential health is tracked.
export const HEALTH_TRACKED_PROVIDERS = ['nomod', 'stripe'] as const;
export type HealthTrackedProvider = (typeof HEALTH_TRACKED_PROVIDERS)[number];

export function isHealthTracked(
  provider: string,
): provider is HealthTrackedProvider {
  return (HEALTH_TRACKED_PROVIDERS as readonly string[]).includes(provider);
}

export const CREDENTIALS_REJECTED = 'rejected';
const ALERT_INTERVAL_HOURS = 24;

const LABEL: Record<HealthTrackedProvider, string> = {
  nomod: 'Nomod',
  stripe: 'Stripe',
};

// True when the provider refused OUR credentials (as opposed to a network error, a
// 5xx, or a refusal of the request itself). Nomod: 401 not_authenticated or 403.
// Stripe: an authentication_error (the SDK's StripeAuthenticationError, HTTP 401).
export function isCredentialRejection(provider: string, err: unknown): boolean {
  if (provider === 'nomod') {
    return (
      err instanceof NomodApiError && (err.status === 401 || err.status === 403)
    );
  }
  if (provider === 'stripe') {
    if (!err || typeof err !== 'object') return false;
    const e = err as { type?: unknown; rawType?: unknown };
    return (
      e.type === 'StripeAuthenticationError' ||
      e.rawType === 'authentication_error'
    );
  }
  return false;
}

export interface CredentialHealth {
  status: 'rejected' | null;
  since: Date | null;
}

// Tracks whether a provider has rejected a shop's OWN saved credentials. Only the
// shop's own keys are judged: a shop running on the platform's fallback key is
// never marked (the row's `credentials IS NOT NULL` guard). Every method here
// never throws: health bookkeeping must not break a checkout or a settings save.
@Injectable()
export class CredentialHealthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly notifications: OrderNotificationsService,
  ) {}

  async getHealth(shopId: number, provider: string): Promise<CredentialHealth> {
    if (!isHealthTracked(provider)) return { status: null, since: null };
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT credentialStatus, credentialStatusAt FROM shoppaymentprovider
        WHERE shopId = ? AND provider = ?`,
      [shopId, provider],
    );
    const row = rows[0];
    if (row?.credentialStatus !== CREDENTIALS_REJECTED) {
      return { status: null, since: null };
    }
    return {
      status: CREDENTIALS_REJECTED,
      since: (row.credentialStatusAt as Date | null) ?? null,
    };
  }

  async isRejected(shopId: number, provider: string): Promise<boolean> {
    return (await this.getHealth(shopId, provider)).status === 'rejected';
  }

  // Observes the outcome of a provider call made with the shop's credentials.
  // `ownCredentials` false (platform fallback key) records nothing.
  async observe(
    shopId: number,
    provider: string,
    ownCredentials: boolean,
    outcome: { ok: true } | { ok: false; error: unknown },
  ): Promise<void> {
    if (!ownCredentials || !isHealthTracked(provider)) return;
    if (outcome.ok) {
      await this.markAccepted(shopId, provider);
    } else if (isCredentialRejection(provider, outcome.error)) {
      await this.markRejected(shopId, provider, { alert: true });
    }
  }

  // Sets the rejected status (keeping the FIRST rejection time) and, when asked,
  // alerts the merchant at most once per 24 hours per provider.
  async markRejected(
    shopId: number,
    provider: HealthTrackedProvider,
    opts: { alert: boolean },
  ): Promise<void> {
    try {
      await this.db.execute(
        `UPDATE shoppaymentprovider
            SET credentialStatus = 'rejected', credentialStatusAt = NOW(3)
          WHERE shopId = ? AND provider = ? AND credentials IS NOT NULL
            AND (credentialStatus IS NULL OR credentialStatus <> 'rejected')`,
        [shopId, provider],
      );
      logger.warn('payment credentials rejected by provider', {
        shopId,
        provider,
      });
      if (opts.alert) await this.alertOnce(shopId, provider);
    } catch (err) {
      logger.error('could not record rejected payment credentials', {
        shopId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Clears the status (a successful call, a successful test, or new credentials).
  async markAccepted(shopId: number, provider: string): Promise<void> {
    if (!isHealthTracked(provider)) return;
    try {
      await this.db.execute(
        `UPDATE shoppaymentprovider
            SET credentialStatus = NULL, credentialStatusAt = NULL
          WHERE shopId = ? AND provider = ? AND credentialStatus IS NOT NULL`,
        [shopId, provider],
      );
    } catch (err) {
      logger.error('could not clear payment credential status', {
        shopId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Compare-and-swap on credentialAlertedAt: only the caller that moves it gets to
  // send, so concurrent failing checkouts produce one alert.
  private async alertOnce(
    shopId: number,
    provider: HealthTrackedProvider,
  ): Promise<void> {
    const claim = await this.db.execute(
      `UPDATE shoppaymentprovider SET credentialAlertedAt = NOW(3)
        WHERE shopId = ? AND provider = ? AND credentialStatus = 'rejected'
          AND (credentialAlertedAt IS NULL
               OR credentialAlertedAt < NOW(3) - INTERVAL ${ALERT_INTERVAL_HOURS} HOUR)`,
      [shopId, provider],
    );
    if (claim.affectedRows !== 1) return;
    const outlets = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE shopId = ? ORDER BY id ASC LIMIT 1`,
      [shopId],
    );
    const outletId = outlets[0]?.id as number | undefined;
    if (!outletId) return;
    const to = await this.notifications.resolveMerchantAlertRecipient(
      shopId,
      outletId,
    );
    if (!to) {
      logger.warn('no merchant alert recipient for rejected credentials', {
        shopId,
        provider,
      });
      return;
    }
    const label = LABEL[provider];
    await this.jobs.enqueue(
      shopId,
      'send_merchant_whatsapp_alert',
      {
        to,
        body: `${label} rejected your API key, so card payments are paused on your store. Open Integrations > Payments in Requital, update your ${label} key and press Test connection.`,
      },
      `payment-creds:${provider}:rejected:${Date.now()}`,
    );
  }
}
