import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { decrypt, encrypt } from '../common/crypto';
import type { TenantContext } from '../common/tenant-context';
import { FeaturesService } from '../features/features.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { ChannelconnectionRow } from '../db/types';
import { PlatformAuditLogService } from '../platform-admin/platform-audit-log.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import type { BoundChannelConnection } from './channel.types';
import { resolveErrorTrackingProvider } from '../common/error-tracking/error-tracking.provider';
import { createLogger } from '../common/logging/logger';
import type {
  CreateChannelConnectionDto,
  SetChannelAvailabilityDto,
  UpdateChannelConnectionDto,
} from './dto/channels.dto';

const logger = createLogger('ChannelConnections');

// A merchant may ask staff to verify a location once a day per connection.
export const VERIFICATION_REQUEST_COOLDOWN_MS = 24 * 3_600_000;

// Never returned: credentials and webhookSecret. The view says only whether
// they are set (write-only fields, like every other credential store here).
export interface ChannelConnectionView {
  id: number;
  outletId: number;
  provider: string;
  externalLocationId: string | null;
  externalBrandId: string | null;
  externalSiteId: string | null;
  hasCredentials: boolean;
  hasWebhookSecret: boolean;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  locationVerified: boolean;
  // When the merchant last asked staff to verify (NULL = never / cleared).
  verificationRequestedAt: Date | null;
  // Opt-in: the sweep may confirm accepted scheduled orders itself (default off).
  autoConfirmScheduled: boolean;
  createdAt: Date;
}

// What platform staff see: the merchant view plus who verified and which outlet.
// Never secrets. Kept separate so the merchant view is not widened.
export interface PlatformChannelConnectionView extends ChannelConnectionView {
  shopId: number;
  outletName: string | null;
  providerDisplayName: string;
  locationVerifiedAt: Date | null;
  locationVerifiedBy: number | null;
}

export interface PendingVerificationView extends PlatformChannelConnectionView {
  shopName: string | null;
  shopSubdomain: string | null;
}

const CREDENTIAL_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

function assertCredentialMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('credentials must be an object of strings');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 20)
    throw new BadRequestException('credentials must have 1 to 20 entries');
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (
      !CREDENTIAL_KEY.test(k) ||
      typeof v !== 'string' ||
      v.length < 1 ||
      v.length > 2000
    )
      throw new BadRequestException(
        'credentials keys must be simple names and values non-empty strings up to 2000 characters',
      );
    out[k] = v;
  }
  return out;
}

@Injectable()
export class ChannelConnectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    private readonly audit: AuditLogService,
    private readonly registry: ChannelProviderRegistry,
    private readonly platformAudit: PlatformAuditLogService,
  ) {}

  static view(row: ChannelconnectionRow): ChannelConnectionView {
    return {
      id: row.id,
      outletId: row.outletId,
      provider: row.provider,
      externalLocationId: row.externalLocationId,
      externalBrandId: row.externalBrandId,
      externalSiteId: row.externalSiteId,
      hasCredentials: !!row.credentials,
      hasWebhookSecret: !!row.webhookSecret,
      enabled: !!row.enabled,
      lastSyncAt: row.lastSyncAt,
      lastSyncStatus: row.lastSyncStatus,
      lastError: row.lastError,
      locationVerified: !!row.locationVerifiedAt,
      verificationRequestedAt: row.verificationRequestedAt ?? null,
      autoConfirmScheduled: !!row.autoConfirmScheduled,
      createdAt: row.createdAt,
    };
  }

  private platformView(
    row: ChannelconnectionRow & { outletName?: string | null },
  ): PlatformChannelConnectionView {
    return {
      ...ChannelConnectionsService.view(row),
      shopId: row.shopId,
      outletName: row.outletName ?? null,
      providerDisplayName:
        this.registry.find(row.provider)?.displayName ?? row.provider,
      locationVerifiedAt: row.locationVerifiedAt,
      locationVerifiedBy: row.locationVerifiedBy,
    };
  }

  private async assertFlag(shopId: number): Promise<void> {
    if (!(await this.features.isEnabled(shopId, 'marketplace_channels'))) {
      throw new ForbiddenException(
        'Marketplace channels are not enabled for this shop',
      );
    }
  }

  private async load(
    ctx: TenantContext,
    id: number,
  ): Promise<ChannelconnectionRow> {
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException('Connection not found');
    return rows[0];
  }

  async availability(
    ctx: TenantContext,
  ): Promise<{ enabled: boolean; hasConnections: boolean }> {
    const [enabled, rows] = await Promise.all([
      this.features.isEnabled(ctx.shopId, 'marketplace_channels'),
      this.db.query<RowDataPacket[]>(
        `SELECT 1 FROM channelconnection WHERE shopId = ? LIMIT 1`,
        [ctx.shopId],
      ),
    ]);
    return { enabled, hasConnections: rows.length > 0 };
  }

  async list(ctx: TenantContext): Promise<ChannelConnectionView[]> {
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection WHERE shopId = ? ORDER BY id`,
      [ctx.shopId],
    );
    return rows.map((r) => ChannelConnectionsService.view(r));
  }

  async create(ctx: TenantContext, dto: CreateChannelConnectionDto) {
    await this.assertFlag(ctx.shopId);
    if (!this.registry.has(dto.provider)) {
      throw new BadRequestException(
        `Unknown channel provider '${dto.provider}'`,
      );
    }
    const outletRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [dto.outletId, ctx.shopId],
    );
    if (outletRows.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    const credentials = dto.credentials
      ? encrypt(JSON.stringify(assertCredentialMap(dto.credentials)))
      : null;
    const secret = dto.webhookSecret ? encrypt(dto.webhookSecret) : null;
    let id: number;
    try {
      const res = await this.db.execute(
        `INSERT INTO channelconnection
           (shopId, outletId, provider, externalLocationId, externalBrandId, externalSiteId, credentials, webhookSecret, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.outletId,
          dto.provider,
          dto.externalLocationId ?? null,
          dto.externalBrandId ?? null,
          dto.externalSiteId ?? null,
          credentials,
          secret,
          new Date(),
        ],
      );
      id = res.insertId;
    } catch (e) {
      if (isDuplicateKeyError(e))
        throw new ConflictException(
          'This outlet already has a connection for that marketplace',
        );
      throw e;
    }
    const row = await this.load(ctx, id);
    await this.audit.logCtx(ctx, {
      action: 'channel.connection_created',
      entityType: 'channelconnection',
      entityId: id,
      after: ChannelConnectionsService.view(row),
    });
    return ChannelConnectionsService.view(row);
  }

  async update(
    ctx: TenantContext,
    id: number,
    dto: UpdateChannelConnectionDto,
  ) {
    const before = await this.load(ctx, id);
    const secretChange =
      dto.credentials !== undefined || dto.webhookSecret !== undefined;
    const sets: string[] = ['updatedAt = ?'];
    const params: QueryParam[] = [new Date()];
    const idChange =
      (dto.externalLocationId !== undefined &&
        dto.externalLocationId !== before.externalLocationId) ||
      (dto.externalBrandId !== undefined &&
        dto.externalBrandId !== before.externalBrandId) ||
      (dto.externalSiteId !== undefined &&
        dto.externalSiteId !== before.externalSiteId);
    // The location id is the routing key: it cannot move under a live connection.
    if (idChange && before.enabled) {
      throw new ConflictException(
        'Disable the connection before changing its ids',
      );
    }
    // Credentials and the webhook secret are what the marketplace's deliveries
    // are checked against: replacing or clearing them under a live connection
    // would silently stop (or redirect) order intake. Disable first.
    if (
      before.enabled &&
      (dto.credentials !== undefined || dto.webhookSecret !== undefined)
    ) {
      throw new ConflictException(
        'Disable the connection before changing its credentials or webhook secret',
      );
    }
    if (dto.externalLocationId !== undefined) {
      sets.push('externalLocationId = ?');
      params.push(dto.externalLocationId);
    }
    if (dto.externalBrandId !== undefined) {
      sets.push('externalBrandId = ?');
      params.push(dto.externalBrandId);
    }
    if (dto.externalSiteId !== undefined) {
      sets.push('externalSiteId = ?');
      params.push(dto.externalSiteId);
    }
    if (dto.credentials !== undefined) {
      sets.push('credentials = ?');
      params.push(
        dto.credentials === null
          ? null
          : encrypt(JSON.stringify(assertCredentialMap(dto.credentials))),
      );
    }
    // Any id or credential in the request voids the staff verification, in the
    // SAME statement as the change, so there is no window where the new value
    // is stored but the old verification still stands.
    if (
      dto.externalLocationId !== undefined ||
      dto.externalBrandId !== undefined ||
      dto.externalSiteId !== undefined ||
      dto.credentials !== undefined
    ) {
      sets.push('locationVerifiedAt = NULL', 'locationVerifiedBy = NULL');
      // The merchant's pending request is withdrawn only when an id ACTUALLY
      // changed (or credentials were replaced, which cannot be compared): a PATCH
      // that repeats the stored values must not drop it from the staff queue. The
      // once-a-day cooldown is separate (verificationNotifiedAt) and never cleared.
      if (idChange || dto.credentials !== undefined) {
        sets.push('verificationRequestedAt = NULL');
      }
    }
    if (dto.autoConfirmScheduled !== undefined) {
      // Only a marketplace that has a confirm step can have it automated.
      if (
        dto.autoConfirmScheduled &&
        !this.registry.find(before.provider)?.capabilities.scheduledConfirm
      ) {
        throw new BadRequestException(
          'This marketplace has no scheduled-order confirm step',
        );
      }
      sets.push('autoConfirmScheduled = ?');
      params.push(dto.autoConfirmScheduled ? 1 : 0);
    }
    if (dto.webhookSecret !== undefined) {
      sets.push('webhookSecret = ?');
      params.push(
        dto.webhookSecret === null ? null : encrypt(dto.webhookSecret),
      );
    }
    // An id change is only valid while the connection is off, and that is
    // checked by the UPDATE itself (not by the read above): a concurrent
    // enable cannot slip between them.
    const res = await this.db.execute(
      `UPDATE channelconnection SET ${sets.join(', ')}
        WHERE id = ? AND shopId = ? ${idChange || secretChange ? 'AND enabled = 0' : ''}`,
      [...params, id, ctx.shopId],
    );
    if (res.affectedRows === 0) {
      throw new ConflictException(
        'The connection changed while saving; reload and try again',
      );
    }
    const after = await this.load(ctx, id);
    await this.audit.logCtx(ctx, {
      action: 'channel.connection_updated',
      entityType: 'channelconnection',
      entityId: id,
      before: ChannelConnectionsService.view(before),
      after: ChannelConnectionsService.view(after),
    });
    return ChannelConnectionsService.view(after);
  }

  // Off by default. Turning it ON needs the flag, the ids and credentials, a
  // passing testConnection(), and PROOF THAT THE LOCATION IS THIS SHOP'S: either
  // the provider has a merchant-bound proof (capabilities.provesLocationOwnership
  // and a test that shows the credentials can see that location) or platform
  // staff have verified the ids with the marketplace (locationVerifiedAt, set
  // only through the platform-admin tier). Marketplace credentials are likely
  // integrator-level, so "these credentials can see the location" alone proves
  // nothing about who the location belongs to.
  //
  // The enable is ONE conditional UPDATE that restates everything that was
  // tested and verified (ids, credentials, secret, the verification itself), so a
  // concurrent edit during the network round trip makes it match no row (409)
  // instead of enabling something nobody checked.
  // Turning it OFF is always allowed.
  async setEnabled(ctx: TenantContext, id: number, enabled: boolean) {
    const row = await this.load(ctx, id);
    if (!enabled) {
      await this.db.execute(
        `UPDATE channelconnection SET enabled = 0, updatedAt = ? WHERE id = ? AND shopId = ?`,
        [new Date(), id, ctx.shopId],
      );
      await this.audit.logCtx(ctx, {
        action: 'channel.connection_disabled',
        entityType: 'channelconnection',
        entityId: id,
      });
      return ChannelConnectionsService.view(await this.load(ctx, id));
    }
    await this.assertFlag(ctx.shopId);
    const provider = this.registry.find(row.provider);
    if (!provider)
      throw new BadRequestException('This marketplace is not available');
    if (!row.externalLocationId) {
      throw new BadRequestException('Set the location id before enabling');
    }
    // Only a platform secret that is actually usable here counts (a provider can
    // switch it off, for example in production).
    const usesPlatformSecret =
      provider.capabilities.platformWebhookSecret &&
      (provider.platformWebhookSecrets?.() ?? []).some(Boolean);
    if (!row.credentials || (!row.webhookSecret && !usesPlatformSecret)) {
      throw new BadRequestException(
        'Credentials and a webhook secret are required before enabling',
      );
    }
    const merchantBound = provider.capabilities.provesLocationOwnership;
    if (!merchantBound && !row.locationVerifiedAt) {
      throw new ConflictException(
        'Requital staff must verify this location with the marketplace before it can be enabled',
      );
    }
    if (!provider.testConnection) {
      throw new BadRequestException('This marketplace has no connection test');
    }
    const test = await provider.testConnection(this.bind(row));
    const proven = test.ok && (!merchantBound || test.provesLocation);
    await this.db.execute(
      `UPDATE channelconnection SET lastSyncAt = ?, lastSyncStatus = ?, lastError = ? WHERE id = ? AND shopId = ?`,
      [
        new Date(),
        proven ? 'ok' : 'failed',
        proven ? null : this.safeMessage(row, test.message),
        id,
        ctx.shopId,
      ],
    );
    if (!proven) {
      throw new BadRequestException(
        `Connection test failed: ${this.safeMessage(row, test.message)}`,
      );
    }
    try {
      const res = await this.db.execute(
        `UPDATE channelconnection SET enabled = 1, updatedAt = ?
          WHERE id = ? AND shopId = ? AND enabled = 0
            AND externalLocationId <=> ? AND externalBrandId <=> ? AND externalSiteId <=> ?
            AND credentials <=> ? AND webhookSecret <=> ?
            AND (? = 1 OR locationVerifiedAt IS NOT NULL)`,
        [
          new Date(),
          id,
          ctx.shopId,
          row.externalLocationId,
          row.externalBrandId,
          row.externalSiteId,
          row.credentials,
          row.webhookSecret,
          merchantBound ? 1 : 0,
        ],
      );
      if (res.affectedRows === 0) {
        throw new ConflictException(
          'The connection changed while it was being checked; review it and try again',
        );
      }
    } catch (e) {
      // UNIQUE(routingKey): another enabled connection owns this location.
      // Deliberately generic: it must not confirm whose it is.
      if (isDuplicateKeyError(e))
        throw new ConflictException('That location is already connected');
      throw e;
    }
    await this.audit.logCtx(ctx, {
      action: 'channel.connection_enabled',
      entityType: 'channelconnection',
      entityId: id,
    });
    return ChannelConnectionsService.view(await this.load(ctx, id));
  }

  // A provider's message is stored and shown to the merchant: cap it and strip
  // any credential value a careless provider echoed into it.
  safeMessage(row: ChannelconnectionRow, message?: string): string {
    let out = (
      message ??
      'the marketplace did not accept the credentials for this location'
    ).slice(0, 500);
    try {
      const secrets = [
        ...Object.values(this.bind(row).credentials ?? {}),
        this.bind(row).webhookSecret ?? '',
      ].filter((v) => v.length >= 4);
      for (const v of secrets) out = out.split(v).join('***');
    } catch {
      /* undecryptable: nothing to redact */
    }
    return out;
  }

  async remove(ctx: TenantContext, id: number) {
    const row = await this.load(ctx, id);
    if (row.enabled) {
      throw new ConflictException('Disable the connection before deleting it');
    }
    const orders = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM channelorder WHERE connectionId = ? LIMIT 1`,
      [id],
    );
    if (orders.length > 0) {
      throw new ConflictException(
        'This connection has marketplace orders; disable it instead',
      );
    }
    // Deleting cascades to the inbox: an event that has not been processed may
    // be an accepted order, so it must be resolved first.
    const pending = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM channelinboundevent WHERE connectionId = ? AND status <> 'processed' LIMIT 1`,
      [id],
    );
    if (pending.length > 0) {
      throw new ConflictException(
        'This connection has unprocessed marketplace deliveries; disable it instead',
      );
    }
    // The checks above are advice; THIS statement is the guard. A webhook that
    // slipped in after them (an enabled flip, a new inbox row, a new order)
    // makes it match nothing, so an acknowledged delivery is never cascaded away.
    const del = await this.db.execute(
      `DELETE FROM channelconnection
        WHERE id = ? AND shopId = ? AND enabled = 0
          AND NOT EXISTS (SELECT 1 FROM channelinboundevent e
                           WHERE e.connectionId = channelconnection.id AND e.status <> 'processed')
          AND NOT EXISTS (SELECT 1 FROM channelorder o WHERE o.connectionId = channelconnection.id)`,
      [id, ctx.shopId],
    );
    if (del.affectedRows === 0) {
      throw new ConflictException(
        'The connection received something while it was being deleted; check it and try again',
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'channel.connection_deleted',
      entityType: 'channelconnection',
      entityId: id,
      before: ChannelConnectionsService.view(row),
    });
    return { deleted: true };
  }

  async testConnection(ctx: TenantContext, id: number) {
    // Flag off means no outbound marketplace call, not even a test.
    await this.assertFlag(ctx.shopId);
    const row = await this.load(ctx, id);
    const provider = this.registry.find(row.provider);
    if (!provider?.testConnection) {
      throw new BadRequestException('This marketplace has no connection test');
    }
    const test = await provider.testConnection(this.bind(row));
    await this.db.execute(
      `UPDATE channelconnection SET lastSyncAt = ?, lastSyncStatus = ?, lastError = ? WHERE id = ? AND shopId = ?`,
      [
        new Date(),
        test.ok ? 'ok' : 'failed',
        test.ok ? null : this.safeMessage(row, test.message),
        id,
        ctx.shopId,
      ],
    );
    return {
      ok: test.ok,
      message: test.ok ? null : this.safeMessage(row, test.message),
    };
  }

  // The merchant asks Requital staff to verify the ids. Once a day per
  // connection, decided by ONE conditional UPDATE (a parallel double click sends
  // one request). Needs the flag (it is part of onboarding a marketplace) and a
  // location id; an already verified connection has nothing to request. Staff
  // find it in the platform "pending verification" list, and one structured error
  // line goes to the existing error-tracking webhook (no new channel).
  async requestVerification(ctx: TenantContext, id: number) {
    await this.assertFlag(ctx.shopId);
    const row = await this.load(ctx, id);
    if (row.locationVerifiedAt) {
      throw new ConflictException('This location is already verified');
    }
    if (!row.externalLocationId) {
      throw new BadRequestException(
        'Set the location id before asking for verification',
      );
    }
    const now = new Date();
    // The gate is verificationNotifiedAt, which only a request writes: a PATCH
    // (even one that repeats the same id) clears verificationRequestedAt but can
    // never reset the cooldown or re-trigger the staff notification.
    const res = await this.db.execute(
      `UPDATE channelconnection SET verificationRequestedAt = ?, verificationNotifiedAt = ?, updatedAt = ?
        WHERE id = ? AND shopId = ? AND locationVerifiedAt IS NULL AND externalLocationId IS NOT NULL
          AND (verificationNotifiedAt IS NULL OR verificationNotifiedAt < ?)`,
      [
        now,
        now,
        now,
        id,
        ctx.shopId,
        new Date(now.getTime() - VERIFICATION_REQUEST_COOLDOWN_MS),
      ],
    );
    if (res.affectedRows === 0) {
      throw new HttpException(
        {
          statusCode: 429,
          message:
            'Verification was already requested in the last 24 hours. Staff have it in their queue.',
        },
        429,
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'channel.verification_requested',
      entityType: 'channelconnection',
      entityId: id,
      after: { provider: row.provider },
    });
    // Ids and counts only: no credential, no secret.
    logger.error('marketplace location verification requested', {
      shopId: ctx.shopId,
      connectionId: id,
      provider: row.provider,
    });
    try {
      resolveErrorTrackingProvider().captureException(
        new Error(
          `Marketplace verification requested: shop ${ctx.shopId}, connection ${id} (${row.provider})`,
        ),
        { shopId: ctx.shopId },
      );
    } catch {
      /* best effort */
    }
    return ChannelConnectionsService.view(await this.load(ctx, id));
  }

  // Marks items (un)available at the marketplace. Admin only, flag on, an ENABLED
  // connection, brand and site ids present, a provider with the capability, and
  // EVERY item id must be one of this shop's own mappings for this provider
  // (a foreign or invented id is a 400 and nothing is sent). The marketplace is
  // called first; a failure changes nothing and is a 502. The Deliveroo Sites API
  // is not enabled for the owner, so the real call is unexercised: tests use the
  // fake provider only.
  async setAvailability(
    ctx: TenantContext,
    id: number,
    dto: SetChannelAvailabilityDto,
  ) {
    await this.assertFlag(ctx.shopId);
    const row = await this.load(ctx, id);
    const provider = this.registry.find(row.provider);
    if (
      !provider?.capabilities.itemAvailability ||
      !provider.setItemAvailability
    ) {
      throw new ConflictException(
        'This marketplace does not support item availability',
      );
    }
    if (!row.enabled) {
      throw new ConflictException('Enable the connection first');
    }
    if (!row.externalBrandId || !row.externalSiteId) {
      throw new ConflictException(
        'Set the brand id and site id on this connection first',
      );
    }
    const ids = [...new Set(dto.items.map((i) => i.externalItemId))];
    const mapped = await this.db.query<RowDataPacket[]>(
      `SELECT externalItemId FROM channelitemmapping
        WHERE shopId = ? AND provider = ? AND externalItemId IN (${ids.map(() => '?').join(', ')})`,
      [ctx.shopId, row.provider, ...ids],
    );
    if (mapped.length !== ids.length) {
      throw new BadRequestException(
        'Every item must be one of your mapped marketplace items',
      );
    }
    try {
      const result = await provider.setItemAvailability(
        this.bind(row),
        dto.items.map((i) => ({
          externalItemId: i.externalItemId,
          available: i.available,
        })),
      );
      if (!result.ok) throw new Error(result.message ?? 'refused');
    } catch (e) {
      logger.warn('marketplace availability failed', {
        shopId: ctx.shopId,
        connectionId: id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      throw new BadGatewayException(
        'The marketplace did not accept the change. Nothing was changed; try again.',
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'channel.availability_set',
      entityType: 'channelconnection',
      entityId: id,
      after: {
        provider: row.provider,
        items: dto.items.map((i) => ({
          externalItemId: i.externalItemId,
          available: i.available,
        })),
      },
    });
    return { updated: dto.items.length };
  }

  // Prep-time adjustment is capability-gated: a provider without it (Deliveroo
  // has none we can use) answers 409 and nothing is called.
  async setPrepTime(ctx: TenantContext, id: number, minutes: number) {
    await this.assertFlag(ctx.shopId);
    const row = await this.load(ctx, id);
    const provider = this.registry.find(row.provider);
    if (!provider?.capabilities.prepTimeAdjust || !provider.adjustPrepTime) {
      throw new ConflictException(
        'This marketplace does not support changing the preparation time',
      );
    }
    if (!row.enabled) {
      throw new ConflictException('Enable the connection first');
    }
    try {
      const result = await provider.adjustPrepTime(this.bind(row), minutes);
      if (!result.ok) throw new Error(result.message ?? 'refused');
    } catch (e) {
      logger.warn('marketplace prep time failed', {
        shopId: ctx.shopId,
        connectionId: id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      throw new BadGatewayException(
        'The marketplace did not accept the change. Nothing was changed; try again.',
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'channel.prep_time_set',
      entityType: 'channelconnection',
      entityId: id,
      after: { provider: row.provider, minutes },
    });
    return { minutes };
  }

  // ---- platform staff (called only from the platform-admin tier) ----------

  // What staff see: ids and verification state, never secrets.
  async listForShop(shopId: number): Promise<PlatformChannelConnectionView[]> {
    const rows = await this.db.query<
      (ChannelconnectionRow & { outletName: string | null } & RowDataPacket)[]
    >(
      `SELECT c.*, o.name AS outletName
         FROM channelconnection c LEFT JOIN outlet o ON o.id = c.outletId AND o.shopId = c.shopId
        WHERE c.shopId = ? ORDER BY c.id`,
      [shopId],
    );
    return rows.map((r) => this.platformView(r));
  }

  // Cross-shop, for staff only: connections a merchant asked to have verified
  // that nobody has verified yet, oldest request first. Capped; never secrets.
  async listPendingVerification(): Promise<PendingVerificationView[]> {
    const rows = await this.db.query<
      (ChannelconnectionRow & {
        outletName: string | null;
        shopName: string | null;
        shopSubdomain: string | null;
      } & RowDataPacket)[]
    >(
      `SELECT c.*, o.name AS outletName, s.name AS shopName, s.subdomain AS shopSubdomain
         FROM channelconnection c
         JOIN shop s ON s.id = c.shopId
         LEFT JOIN outlet o ON o.id = c.outletId AND o.shopId = c.shopId
        WHERE c.verificationRequestedAt IS NOT NULL AND c.locationVerifiedAt IS NULL
        ORDER BY c.verificationRequestedAt ASC, c.id ASC
        LIMIT 100`,
    );
    return rows.map((r) => ({
      ...this.platformView(r),
      shopName: r.shopName,
      shopSubdomain: r.shopSubdomain,
    }));
  }

  // Staff confirm the ids THEY checked with the marketplace's integration
  // team. The UPDATE restates those ids, so if the merchant changed anything
  // after staff looked, nothing is verified (409). The audit row is written in
  // the same transaction: no verification without a record.
  async platformVerifyLocation(
    platformAdminId: number,
    shopId: number,
    id: number,
    confirmed: {
      externalLocationId: string;
      externalBrandId: string | null;
      externalSiteId: string | null;
    },
  ): Promise<PlatformChannelConnectionView> {
    await this.db.transaction(async (conn) => {
      const [res] = await conn.query(
        `UPDATE channelconnection SET locationVerifiedAt = ?, locationVerifiedBy = ?, updatedAt = ?
          WHERE id = ? AND shopId = ?
            AND externalLocationId <=> ? AND externalBrandId <=> ? AND externalSiteId <=> ?`,
        [
          new Date(),
          platformAdminId,
          new Date(),
          id,
          shopId,
          confirmed.externalLocationId,
          confirmed.externalBrandId,
          confirmed.externalSiteId,
        ],
      );
      if ((res as { affectedRows: number }).affectedRows === 0) {
        throw new ConflictException(
          'No such connection, or its ids differ from the ones confirmed',
        );
      }
      await this.platformAudit.log(
        platformAdminId,
        'shop.channel_connection.location_verified',
        shopId,
        { connectionId: id, ...confirmed },
        conn,
      );
    });
    return (await this.listForShop(shopId)).find((c) => c.id === id)!;
  }

  async platformUnverifyLocation(
    platformAdminId: number,
    shopId: number,
    id: number,
  ): Promise<PlatformChannelConnectionView> {
    await this.db.transaction(async (conn) => {
      const [res] = await conn.query(
        `UPDATE channelconnection SET locationVerifiedAt = NULL, locationVerifiedBy = NULL, enabled = 0, updatedAt = ?
          WHERE id = ? AND shopId = ?`,
        [new Date(), id, shopId],
      );
      if ((res as { affectedRows: number }).affectedRows === 0) {
        throw new NotFoundException('Connection not found');
      }
      await this.platformAudit.log(
        platformAdminId,
        'shop.channel_connection.location_unverified',
        shopId,
        { connectionId: id },
        conn,
      );
    });
    return (await this.listForShop(shopId)).find((c) => c.id === id)!;
  }

  // Decrypts one connection for a provider call. Takes a row the caller loaded
  // through a shop-scoped query (or the inbox, which carries its own shopId).
  bind(row: ChannelconnectionRow): BoundChannelConnection {
    return {
      id: row.id,
      shopId: row.shopId,
      outletId: row.outletId,
      provider: row.provider,
      externalLocationId: row.externalLocationId,
      externalBrandId: row.externalBrandId,
      externalSiteId: row.externalSiteId,
      credentials: row.credentials
        ? (JSON.parse(decrypt(row.credentials)) as Record<string, string>)
        : null,
      webhookSecret: row.webhookSecret ? decrypt(row.webhookSecret) : null,
    };
  }

  // For the sweeps and the processor, which work from a stored connection id.
  async findById(id: number): Promise<ChannelconnectionRow | null> {
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }
}
