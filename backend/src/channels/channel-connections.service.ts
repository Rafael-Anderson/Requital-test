import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { ChannelProviderRegistry } from './channel-provider.registry';
import type { BoundChannelConnection } from './channel.types';
import type {
  CreateChannelConnectionDto,
  UpdateChannelConnectionDto,
} from './dto/channels.dto';

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
  createdAt: Date;
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
    if (!CREDENTIAL_KEY.test(k) || typeof v !== 'string' || v.length < 1 || v.length > 2000)
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
      createdAt: row.createdAt,
    };
  }

  private async assertFlag(shopId: number): Promise<void> {
    if (!(await this.features.isEnabled(shopId, 'marketplace_channels'))) {
      throw new ForbiddenException(
        'Marketplace channels are not enabled for this shop',
      );
    }
  }

  private async load(ctx: TenantContext, id: number): Promise<ChannelconnectionRow> {
    const rows = await this.db.query<(ChannelconnectionRow & RowDataPacket)[]>(
      `SELECT * FROM channelconnection WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException('Connection not found');
    return rows[0];
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
      throw new BadRequestException(`Unknown channel provider '${dto.provider}'`);
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

  async update(ctx: TenantContext, id: number, dto: UpdateChannelConnectionDto) {
    const before = await this.load(ctx, id);
    const sets: string[] = ['updatedAt = ?'];
    const params: QueryParam[] = [new Date()];
    const idChange =
      dto.externalLocationId !== undefined &&
      dto.externalLocationId !== before.externalLocationId;
    // The location id is the routing key: it cannot move under a live connection.
    if (idChange && before.enabled) {
      throw new ConflictException(
        'Disable the connection before changing its location id',
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
    if (dto.webhookSecret !== undefined) {
      sets.push('webhookSecret = ?');
      params.push(dto.webhookSecret === null ? null : encrypt(dto.webhookSecret));
    }
    await this.db.execute(
      `UPDATE channelconnection SET ${sets.join(', ')} WHERE id = ? AND shopId = ?`,
      [...params, id, ctx.shopId],
    );
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
  // registered provider that can prove location ownership, and a passing
  // testConnection(). Turning it OFF is always allowed.
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
    if (!provider) throw new BadRequestException('This marketplace is not available');
    if (!row.externalLocationId) {
      throw new BadRequestException('Set the location id before enabling');
    }
    const usesPlatformSecret = provider.capabilities.platformWebhookSecret;
    if (!row.credentials || (!row.webhookSecret && !usesPlatformSecret)) {
      throw new BadRequestException(
        'Credentials and a webhook secret are required before enabling',
      );
    }
    if (!provider.capabilities.provesLocationOwnership || !provider.testConnection) {
      throw new BadRequestException(
        'This marketplace cannot yet verify location ownership, so it cannot be enabled',
      );
    }
    const test = await provider.testConnection(this.bind(row));
    await this.db.execute(
      `UPDATE channelconnection SET lastSyncAt = ?, lastSyncStatus = ?, lastError = ? WHERE id = ? AND shopId = ?`,
      [
        new Date(),
        test.ok && test.provesLocation ? 'ok' : 'failed',
        test.ok && test.provesLocation ? null : (test.message ?? 'Connection test failed').slice(0, 500),
        id,
        ctx.shopId,
      ],
    );
    if (!test.ok || !test.provesLocation) {
      throw new BadRequestException(
        `Connection test failed: ${test.message ?? 'the marketplace did not accept the credentials for this location'}`,
      );
    }
    try {
      await this.db.execute(
        `UPDATE channelconnection SET enabled = 1, updatedAt = ? WHERE id = ? AND shopId = ?`,
        [new Date(), id, ctx.shopId],
      );
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

  async remove(ctx: TenantContext, id: number) {
    const row = await this.load(ctx, id);
    const orders = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM channelorder WHERE connectionId = ? LIMIT 1`,
      [id],
    );
    if (orders.length > 0) {
      throw new ConflictException(
        'This connection has marketplace orders; disable it instead',
      );
    }
    await this.db.execute(
      `DELETE FROM channelconnection WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    await this.audit.logCtx(ctx, {
      action: 'channel.connection_deleted',
      entityType: 'channelconnection',
      entityId: id,
      before: ChannelConnectionsService.view(row),
    });
    return { deleted: true };
  }

  async testConnection(ctx: TenantContext, id: number) {
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
        test.ok ? null : (test.message ?? 'Connection test failed').slice(0, 500),
        id,
        ctx.shopId,
      ],
    );
    return { ok: test.ok, message: test.message ?? null };
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
