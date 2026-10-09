import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { assertCustomerInShop, lockCustomerInShop } from './customer-scope';
import {
  CONSENT_CHANNELS,
  CONSENT_WORDING_VERSION,
  consentWordingText,
  type ConsentChannel,
  type ConsentSource,
  type ConsentStatus,
} from './consent-wording';
import type { RecordConsentDto } from './dto/crm.dto';

export interface ConsentState {
  channel: ConsentChannel;
  // null = UNKNOWN: nobody ever recorded an answer. Never false.
  status: ConsentStatus | null;
  source: string | null;
  wordingVersion: string | null;
  updatedAt: Date | null;
}

export interface RecordInput {
  channel: ConsentChannel;
  status: ConsentStatus;
  source: ConsentSource;
  wordingVersion?: string | null;
  wordingText?: string | null;
  actorUserId?: number | null;
  note?: string | null;
}

// CUS-11. See the migration header for the data model. The invariants:
//  - unknown is the ABSENCE of a customerconsent row; this file never writes a
//    row to say "unknown", and nothing here defaults a customer to anything;
//  - every change is one customerconsent upsert plus one append-only event, in
//    one transaction, under a lock on the customer row (so two concurrent
//    toggles cannot interleave a state that disagrees with the last event);
//  - a request that would not change the state writes nothing (idempotent).
@Injectable()
export class CustomerConsentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getForCustomer(shopId: number, customerId: number) {
    await assertCustomerInShop(this.db, shopId, customerId);
    return this.read(shopId, customerId);
  }

  // Customer-account read: the same shape, minus the newsletter lookup and the
  // history (the customer sees only their own current answers).
  async channelsFor(shopId: number, customerId: number): Promise<ConsentState[]> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT channel, status, source, wordingVersion, updatedAt
         FROM customerconsent WHERE customerId = ? AND shopId = ?`,
      [customerId, shopId],
    );
    return this.fill(rows);
  }

  // PDPL export: the customer's own consent answers and their history. No staff
  // names (actorUserId is internal), no notes.
  async exportFor(shopId: number, customerId: number) {
    const [channels, events] = await Promise.all([
      this.channelsFor(shopId, customerId),
      this.db.query<RowDataPacket[]>(
        `SELECT channel, status, source, wordingVersion, wordingText, createdAt
           FROM customerconsentevent
          WHERE customerId = ? AND shopId = ?
          ORDER BY createdAt, id`,
        [customerId, shopId],
      ),
    ]);
    return {
      channels,
      history: events.map((e) => ({
        channel: e.channel as string,
        status: e.status as string,
        source: e.source as string,
        wordingVersion: (e.wordingVersion as string | null) ?? null,
        wordingText: (e.wordingText as string | null) ?? null,
        at: e.createdAt as Date,
      })),
    };
  }

  async recordByAdmin(ctx: TenantContext, customerId: number, dto: RecordConsentDto) {
    const note = dto.note?.trim() || null;
    if (dto.status === 'granted' && !note) {
      throw new BadRequestException(
        'Say how this consent was obtained (for example "verbal, in store, 2026-10-08")',
      );
    }
    const shopName = await this.shopName(ctx.shopId);
    const changed = await this.record(ctx.shopId, customerId, {
      channel: dto.channel,
      status: dto.status,
      source: 'admin',
      wordingVersion: CONSENT_WORDING_VERSION,
      // The admin did not show the customer this sentence; it is stored so the
      // record names what the answer is taken to cover, with the note beside it.
      wordingText: consentWordingText(dto.channel, shopName),
      actorUserId: ctx.userId,
      note,
    });
    if (changed) {
      await this.auditLog.logCtx(ctx, {
        action: 'customer.consent.recorded',
        entityType: 'customer',
        entityId: customerId,
        after: { channel: dto.channel, status: dto.status, source: 'admin' },
      });
    }
    return this.read(ctx.shopId, customerId);
  }

  // Customer self-service (storefront account). Wording is the server's.
  async recordByCustomer(
    shopId: number,
    customerId: number,
    channel: ConsentChannel,
    granted: boolean,
  ) {
    const shopName = await this.shopName(shopId);
    await this.record(shopId, customerId, {
      channel,
      status: granted ? 'granted' : 'withdrawn',
      source: 'storefront_account',
      wordingVersion: CONSENT_WORDING_VERSION,
      wordingText: consentWordingText(channel, shopName),
    });
    return this.channelsFor(shopId, customerId);
  }

  // What the storefront shows next to each toggle.
  async wordingFor(shopId: number) {
    const shopName = await this.shopName(shopId);
    return {
      version: CONSENT_WORDING_VERSION,
      channels: Object.fromEntries(
        CONSENT_CHANNELS.map((c) => [c, consentWordingText(c, shopName)]),
      ),
    };
  }

  // Returns true when state changed. Pool-free inside the transaction.
  async record(shopId: number, customerId: number, input: RecordInput): Promise<boolean> {
    return this.db.transaction(async (conn) => {
      await lockCustomerInShop(conn, shopId, customerId);
      return this.recordOn(conn, shopId, customerId, input);
    });
  }

  // For callers that already hold the customer lock inside their own transaction.
  async recordOn(
    conn: PoolConnection,
    shopId: number,
    customerId: number,
    input: RecordInput,
  ): Promise<boolean> {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT status FROM customerconsent WHERE customerId = ? AND channel = ? FOR UPDATE`,
      [customerId, input.channel],
    );
    if (rows[0]?.status === input.status) return false;
    await conn.query(
      `INSERT INTO customerconsent (customerId, channel, shopId, status, source, wordingVersion)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), source = VALUES(source),
         wordingVersion = VALUES(wordingVersion), updatedAt = CURRENT_TIMESTAMP(3)`,
      [
        customerId,
        input.channel,
        shopId,
        input.status,
        input.source,
        input.wordingVersion ?? null,
      ],
    );
    await conn.query(
      `INSERT INTO customerconsentevent
         (shopId, customerId, channel, status, source, wordingVersion, wordingText, actorUserId, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        customerId,
        input.channel,
        input.status,
        input.source,
        input.wordingVersion ?? null,
        input.wordingText ?? null,
        input.actorUserId ?? null,
        input.note ?? null,
      ],
    );
    return true;
  }

  private async read(shopId: number, customerId: number) {
    const [states, events, newsletter] = await Promise.all([
      this.channelsFor(shopId, customerId),
      this.db.query<RowDataPacket[]>(
        `SELECT e.id, e.channel, e.status, e.source, e.wordingVersion, e.wordingText,
                e.note, e.createdAt, e.actorUserId, u.name AS actorName
           FROM customerconsentevent e
           LEFT JOIN user u ON u.id = e.actorUserId AND u.shopId = e.shopId
          WHERE e.customerId = ? AND e.shopId = ?
          ORDER BY e.createdAt DESC, e.id DESC
          LIMIT 100`,
        [customerId, shopId],
      ),
      // The newsletter widget is its OWN subscription list and stays the source
      // of truth for it. It is read here, never copied into customerconsent: a
      // subscription is not a recorded answer for the customer's channels, and
      // storing it twice would leave two places that can disagree. The join is
      // on the email, case-insensitively, and shows only that it exists.
      this.db.query<RowDataPacket[]>(
        `SELECT s.source, s.createdAt
           FROM customer c
           JOIN newslettersubscriber s
             ON s.shopId = c.shopId
            AND s.email COLLATE utf8mb4_unicode_ci = c.email COLLATE utf8mb4_unicode_ci
          WHERE c.id = ? AND c.shopId = ?
          LIMIT 1`,
        [customerId, shopId],
      ),
    ]);
    return {
      channels: states,
      newsletter: newsletter[0]
        ? {
            subscribed: true,
            since: newsletter[0].createdAt as Date,
            source: newsletter[0].source as string,
          }
        : { subscribed: false, since: null, source: null },
      history: events.map((e) => ({
        id: e.id as number,
        channel: e.channel as string,
        status: e.status as string,
        source: e.source as string,
        wordingVersion: (e.wordingVersion as string | null) ?? null,
        wordingText: (e.wordingText as string | null) ?? null,
        note: (e.note as string | null) ?? null,
        actorName: (e.actorName as string | null) ?? null,
        createdAt: e.createdAt as Date,
      })),
    };
  }

  private fill(rows: RowDataPacket[]): ConsentState[] {
    const by = new Map(rows.map((r) => [r.channel as string, r]));
    return CONSENT_CHANNELS.map((channel) => {
      const r = by.get(channel);
      return {
        channel,
        status: r ? (r.status as ConsentStatus) : null,
        source: r ? (r.source as string) : null,
        wordingVersion: r ? ((r.wordingVersion as string | null) ?? null) : null,
        updatedAt: r ? (r.updatedAt as Date) : null,
      };
    });
  }

  private async shopName(shopId: number): Promise<string> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT name FROM shop WHERE id = ?`,
      [shopId],
    );
    return (rows[0]?.name as string | undefined) ?? 'this shop';
  }
}
