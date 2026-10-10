import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { hashToken } from '../common/token-hash';
import { trimDecimal } from '../database/decimal.util';
import { FixedWindowLimiter } from './fixed-window-limiter';
import { LINK_TOKEN_SHAPE } from './driver-link';
import type { TenantContext } from '../common/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { OrderNotificationsService } from '../orders/order-notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StorageService } from '../storage/storage.service';
import { createLogger } from '../common/logging/logger';
import { decimalToMinor, minorToDecimal, parseCashInput } from './cash';
import { generateOtp, hashOtp, newOtpSalt, otpMatches } from './otp';
import { completeRunIfDone, poolExec } from './run-lifecycle';
import type { DeliverStopDto, FailStopDto } from './dto/driver-app.dto';

const logger = createLogger('DriverAppService');

// Everything a verified link resolves to. EVERYTHING the driver can do is
// derived from this row, never from an id the client sends: the run, the shop,
// the outlet and the driver all come from the link's own record.
export interface LinkContext {
  linkId: number;
  tokenHash: string;
  shopId: number;
  runId: number;
  outletId: number;
  driverId: number;
  driverName: string;
  runStatus: 'dispatched' | 'in_progress';
  proofRequirement: 'photo_or_otp' | 'photo' | 'otp' | 'none';
  shopName: string;
  countryCode: string | null;
}

// One identical 404 for every way a link can be unusable: malformed, unknown,
// expired, revoked, run finished, driver deactivated, shop suspended. Nothing
// distinguishes them, so a probe learns nothing.
function notFound(): NotFoundException {
  return new NotFoundException('Not found');
}

@Injectable()
export class DriverAppService {
  // Ceilings per LINK (on top of the per-IP Throttler): reads, and the heavier
  // or sensitive writes (code send, photo, deliver, fail).
  private readonly readLimiter = new FixedWindowLimiter(120, 60_000);
  private readonly writeLimiter = new FixedWindowLimiter(40, 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
    private readonly notifications: OrderNotificationsService,
    private readonly audit: AuditLogService,
    private readonly storage: StorageService,
  ) {}

  // The single entry point. One query joins the link to its run, driver and shop
  // and applies every liveness condition in SQL, so there is no gap between
  // "found" and "still valid".
  async resolve(
    token: string | undefined,
    kind: 'read' | 'write' = 'read',
  ): Promise<LinkContext> {
    if (typeof token !== 'string' || !LINK_TOKEN_SHAPE.test(token)) {
      throw notFound();
    }
    const tokenHash = hashToken(token);
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT l.id AS linkId, l.shopId, l.runId, l.driverId,
              r.outletId, r.status AS runStatus, r.proofRequirement,
              d.name AS driverName,
              COALESCE(s.displayName, s.name) AS shopName, s.countryCode
         FROM deliveryrunlink l
         JOIN deliveryrun r ON r.id = l.runId AND r.shopId = l.shopId AND r.driverId = l.driverId
         JOIN driver d ON d.id = l.driverId AND d.shopId = l.shopId AND d.active = 1
         JOIN shop s ON s.id = l.shopId AND s.suspendedAt IS NULL
        WHERE l.tokenHash = ? AND l.revokedAt IS NULL AND l.expiresAt > NOW(3)
          AND r.status IN ('dispatched', 'in_progress')`,
      [tokenHash],
    );
    if (rows.length === 0) throw notFound();
    // Limit only a REAL link (an unknown token costs one indexed lookup and is
    // bounded by the per-IP throttle), and before doing any real work.
    const allowed =
      kind === 'write'
        ? this.writeLimiter.hit(tokenHash)
        : this.readLimiter.hit(tokenHash);
    if (!allowed) {
      throw new HttpException(
        { statusCode: 429, message: 'Too many requests, slow down' },
        429,
      );
    }
    const r = rows[0];
    // Cheap "last seen" for staff, at most once a minute per link.
    await this.db.execute(
      `UPDATE deliveryrunlink SET lastUsedAt = NOW(3)
        WHERE id = ? AND (lastUsedAt IS NULL OR lastUsedAt < DATE_SUB(NOW(3), INTERVAL 1 MINUTE))`,
      [r.linkId as number],
    );
    return {
      linkId: r.linkId as number,
      tokenHash,
      shopId: r.shopId as number,
      runId: r.runId as number,
      outletId: r.outletId as number,
      driverId: r.driverId as number,
      driverName: r.driverName as string,
      runStatus: r.runStatus as LinkContext['runStatus'],
      proofRequirement: r.proofRequirement as LinkContext['proofRequirement'],
      shopName: r.shopName as string,
      countryCode: r.countryCode as string | null,
    };
  }

  // What the driver sees: THIS run's stops and, per stop, only what the job needs.
  // No prices other than the cash to collect, no customer email, no other order,
  // run, driver or shop, no internal ids beyond the stop's own.
  async getRun(token: string | undefined) {
    const link = await this.resolve(token, 'read');
    const stops = await this.db.query<RowDataPacket[]>(
      `SELECT s.id, s.position, s.status, s.failureReason, s.deliveredAt,
              (s.proofPhotoKey IS NOT NULL) AS hasPhoto,
              (s.otpHash IS NOT NULL AND s.otpExpiresAt > NOW(3) AND s.otpAttempts < ${MAX_OTP_ATTEMPTS}) AS codActive,
              s.otpSendCount, s.cashCollectedAmount, s.cashDiscrepancy,
              o.id AS orderId, o.shopOrderNumber, o.customerName, o.customerPhone, o.customerAddress,
              o.area, o.deliveryNotes, o.deliveryTimeSlot, o.status AS orderStatus,
              o.paymentMethod, o.total, o.currency, o.cashCollectedAt, rg.nameEn AS regionName
         FROM deliveryrunstop s
         JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
         LEFT JOIN region rg ON rg.id = o.regionId
        WHERE s.runId = ? AND s.shopId = ?
        ORDER BY s.position ASC, s.id ASC`,
      [link.runId, link.shopId],
    );
    const items = stops.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT orderId, productName, variantLabel, quantity FROM orderitem
            WHERE orderId IN (${stops.map(() => '?').join(', ')}) ORDER BY id`,
          stops.map((s) => s.orderId as number),
        )
      : [];
    const itemsByOrder = new Map<number, string[]>();
    for (const i of items) {
      const list = itemsByOrder.get(i.orderId as number) ?? [];
      list.push(
        `${i.quantity as number} x ${i.productName as string}${i.variantLabel ? ` (${i.variantLabel as string})` : ''}`,
      );
      itemsByOrder.set(i.orderId as number, list);
    }
    return {
      shopName: link.shopName,
      driverName: link.driverName,
      run: { status: link.runStatus, proofRequirement: link.proofRequirement },
      stops: stops.map((s) => {
        const cod = s.paymentMethod === 'cash_on_delivery';
        return {
          id: s.id as number,
          position: s.position as number,
          status: s.status as string,
          failureReason: s.failureReason as string | null,
          // The customer's own details, as the job needs them.
          orderNumber: s.shopOrderNumber as number,
          customerName: s.customerName as string,
          customerPhone: s.customerPhone as string,
          address: [s.customerAddress, s.area, s.regionName]
            .filter((x): x is string => typeof x === 'string' && x.length > 0)
            .join(', '),
          deliveryNotes: s.deliveryNotes as string | null,
          timeSlot: s.deliveryTimeSlot as string | null,
          items: itemsByOrder.get(s.orderId as number) ?? [],
          // Can this stop be completed right now? A cancelled order must not be
          // delivered; the app greys the stop out.
          deliverable:
            s.status === 'pending' && s.orderStatus === 'out_for_delivery',
          orderCancelled: s.orderStatus === 'cancelled',
          cod: cod
            ? {
                amount: trimDecimal(s.total as string),
                currency: s.currency as string,
                // Already collected (a retry after a half-finished delivery, or
                // staff took it by hand): nothing left to take on the doorstep.
                alreadyCollected:
                  s.cashCollectedAt != null && s.status !== 'delivered',
              }
            : null,
          proof: {
            hasPhoto: Number(s.hasPhoto) === 1,
            codActive: Number(s.codActive) === 1,
            codSendsLeft: Math.max(
              0,
              MAX_OTP_SENDS - (s.otpSendCount as number),
            ),
          },
          cashDiscrepancy: Boolean(s.cashDiscrepancy),
        };
      }),
    };
  }

  // ------------------------------------------------------------------ actions
  // Every action re-derives the stop from the LINK: the stop id from the URL is
  // only ever used as `WHERE id = ? AND runId = <the link's run> AND shopId =
  // <the link's shop>`, so a stop of another run, outlet or shop is simply "not
  // found". Status changes are compare-and-swap, so a retry or a double tap finds
  // the work already done and changes nothing.

  // The context the shared order code runs under. userId 0 is not a user: any
  // code that tried to use it as an FK would fail loudly instead of mis-
  // attributing; AuditLogService and collectCash read `driver` instead.
  private driverCtx(link: LinkContext): TenantContext {
    return {
      userId: 0,
      shopId: link.shopId,
      role: 'admin',
      outletId: null,
      driver: { id: link.driverId, name: link.driverName },
    };
  }

  private async loadStop(link: LinkContext, stopId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT s.*, o.status AS orderStatus, o.paymentMethod, o.total AS orderTotal, o.currency AS orderCurrency,
              o.cashCollectedAt AS orderCashCollectedAt, o.customerName, o.customerPhone, o.customerEmail,
              o.shopOrderNumber, o.id AS oid
         FROM deliveryrunstop s JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
        WHERE s.id = ? AND s.runId = ? AND s.shopId = ?`,
      [stopId, link.runId, link.shopId],
    );
    if (rows.length === 0) throw notFound();
    return rows[0];
  }

  // Ask the customer's channels to deliver a fresh one-time code. At most 3 per
  // stop, 30 seconds apart, claimed atomically BEFORE the code is made. The code
  // is never in the response.
  async sendCode(token: string | undefined, stopId: number) {
    const link = await this.resolve(token, 'write');
    const stop = await this.loadStop(link, stopId);
    if (link.proofRequirement === 'photo' || link.proofRequirement === 'none') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'code_not_used',
        message: 'This run does not use customer codes',
      });
    }
    if (stop.status !== 'pending' || stop.orderStatus !== 'out_for_delivery') {
      throw new ConflictException('This stop can no longer be delivered');
    }
    const claimed = await this.db.execute(
      `UPDATE deliveryrunstop SET otpSendCount = otpSendCount + 1, otpSentAt = NOW(3)
        WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'
          AND otpSendCount < ${MAX_OTP_SENDS}
          AND (otpSentAt IS NULL OR otpSentAt < DATE_SUB(NOW(3), INTERVAL 30 SECOND))`,
      [stopId, link.runId, link.shopId],
    );
    if (claimed.affectedRows === 0) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'code_send_limit',
          message:
            'Wait a moment before asking for another code, or use a photo',
        },
        429,
      );
    }
    const code = generateOtp();
    const salt = newOtpSalt();
    await this.db.execute(
      `UPDATE deliveryrunstop SET otpHash = ?, otpSalt = ?, otpAttempts = 0,
              otpExpiresAt = DATE_ADD(NOW(3), INTERVAL ${OTP_TTL_MINUTES} MINUTE)
        WHERE id = ? AND runId = ? AND shopId = ?`,
      [hashOtp(stopId, salt, code), salt, stopId, link.runId, link.shopId],
    );
    const sent = await this.notifications.sendDeliveryCode(
      link.shopId,
      {
        id: stop.oid as number,
        shopOrderNumber: stop.shopOrderNumber as number,
        customerName: stop.customerName as string,
        customerEmail: stop.customerEmail as string | null,
        customerPhone: stop.customerPhone as string,
        orderType: 'delivery',
        total: stop.orderTotal as string,
        currency: stop.orderCurrency as string,
        outletId: link.outletId,
      },
      code,
      `delivery-code:${stopId}:${(stop.otpSendCount as number) + 1}`,
    );
    return { sent, expiresInMinutes: OTP_TTL_MINUTES };
  }

  async uploadPhoto(
    token: string | undefined,
    stopId: number,
    file: Express.Multer.File | undefined,
  ) {
    const link = await this.resolve(token, 'write');
    if (!file) {
      throw new BadRequestException('Attach a photo in the "photo" field');
    }
    const stop = await this.loadStop(link, stopId);
    if (stop.status !== 'pending') {
      throw new ConflictException('This stop is already closed');
    }
    const saved = await this.storage.uploadProof(link.shopId, file);
    const res = await this.db.execute(
      `UPDATE deliveryrunstop SET proofPhotoKey = ?, proofPhotoUrl = ?, proofPhotoAt = NOW(3)
        WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'`,
      [saved.key, saved.url, stopId, link.runId, link.shopId],
    );
    if (res.affectedRows === 0) {
      // The stop closed while we were uploading: do not leave an orphan.
      await this.storage
        .deleteProof(link.shopId, saved.key)
        .catch(() => undefined);
      throw new ConflictException('This stop is already closed');
    }
    const old = stop.proofPhotoKey as string | null;
    if (old)
      await this.storage.deleteProof(link.shopId, old).catch(() => undefined);
    return { hasPhoto: true };
  }

  // Counts the attempt FIRST, atomically and bounded in SQL, and only then
  // compares. So concurrent guesses cannot exceed the cap, an expired or never-
  // sent code allows none, and the compare is constant-time.
  private async verifyCode(link: LinkContext, stopId: number, code: string) {
    const claimed = await this.db.execute(
      `UPDATE deliveryrunstop SET otpAttempts = otpAttempts + 1
        WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'
          AND otpHash IS NOT NULL AND otpExpiresAt > NOW(3) AND otpAttempts < ${MAX_OTP_ATTEMPTS}`,
      [stopId, link.runId, link.shopId],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'code_unavailable',
        message:
          'That code has expired or was used up. Ask the customer for a new code',
      });
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT otpHash, otpSalt, otpAttempts FROM deliveryrunstop WHERE id = ? AND runId = ? AND shopId = ?`,
      [stopId, link.runId, link.shopId],
    );
    const r = rows[0];
    if (
      !r ||
      !r.otpHash ||
      !r.otpSalt ||
      !otpMatches(stopId, r.otpSalt as string, code, r.otpHash as string)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'invalid_code',
        message: 'That code is not right',
        attemptsLeft: Math.max(
          0,
          MAX_OTP_ATTEMPTS - Number(r?.otpAttempts ?? MAX_OTP_ATTEMPTS),
        ),
      });
    }
  }

  async deliver(
    token: string | undefined,
    stopId: number,
    dto: DeliverStopDto,
  ) {
    const link = await this.resolve(token, 'write');
    const stop = await this.loadStop(link, stopId);

    if (stop.status === 'delivered') {
      // Idempotent: nothing is recomputed. Only finish what a crash may have left.
      return this.finishDelivery(link, stop, true);
    }
    if (stop.status !== 'pending') {
      throw new ConflictException('This stop is already closed');
    }
    if (stop.orderStatus !== 'out_for_delivery') {
      throw new ConflictException({
        statusCode: 409,
        code: 'order_not_deliverable',
        message: 'This order is no longer deliverable. Do not hand it over',
      });
    }

    // --- proof
    const requirement = link.proofRequirement;
    const hasPhoto = stop.proofPhotoKey != null;
    let otpOk = false;
    if (dto.code !== undefined) {
      await this.verifyCode(link, stopId, dto.code);
      otpOk = true;
    }
    const satisfied =
      requirement === 'none' ||
      (requirement === 'photo' && hasPhoto) ||
      (requirement === 'otp' && otpOk) ||
      (requirement === 'photo_or_otp' && (hasPhoto || otpOk));
    if (!satisfied) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'proof_required',
        message:
          requirement === 'photo'
            ? 'Take a delivery photo first'
            : requirement === 'otp'
              ? "Enter the customer's code first"
              : "Take a delivery photo or enter the customer's code first",
      });
    }
    const proofType =
      hasPhoto && otpOk ? 'both' : hasPhoto ? 'photo' : otpOk ? 'otp' : 'none';

    // --- cash (integer minor units, the ORDER's currency, exact decimal parsing)
    const currency = stop.orderCurrency as string;
    const isCod = stop.paymentMethod === 'cash_on_delivery';
    const alreadyCollected = stop.orderCashCollectedAt != null;
    let codExpected: string | null = null;
    let collected: string | null = null;
    let discrepancy = false;
    if (isCod && !alreadyCollected) {
      if (dto.cashCollected === undefined) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'cash_required',
          message: 'Enter the cash you collected',
        });
      }
      const collectedMinor = parseCashInput(dto.cashCollected, currency);
      const expectedMinor = decimalToMinor(stop.orderTotal as string, currency);
      if (collectedMinor === null || expectedMinor === null) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'cash_invalid',
          message: `Enter the amount in ${currency} with at most the currency's decimals`,
        });
      }
      codExpected = minorToDecimal(expectedMinor, currency);
      collected = minorToDecimal(collectedMinor, currency);
      // A mismatch never blocks the delivery (the goods are handed over) and is
      // never silently accepted: it is flagged on the stop and in the audit log.
      discrepancy = collectedMinor !== expectedMinor;
    } else if (dto.cashCollected !== undefined && !isCod) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'not_cod',
        message: 'This is not a cash on delivery order',
      });
    }

    const claimed = await this.db.execute(
      `UPDATE deliveryrunstop
          SET status = 'delivered', deliveredAt = NOW(3), activeOrderId = NULL, proofType = ?,
              codExpected = ?, cashCollectedAmount = ?, cashCurrency = ?, cashDiscrepancy = ?,
              otpHash = NULL, otpSalt = NULL, updatedAt = NOW(3)
        WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'`,
      [
        proofType,
        codExpected,
        collected,
        collected === null ? null : currency,
        discrepancy ? 1 : 0,
        stopId,
        link.runId,
        link.shopId,
      ],
    );
    const after = await this.loadStop(link, stopId);
    if (claimed.affectedRows === 0) {
      // Lost a race. If the winner delivered it, this is the idempotent path.
      if (after.status === 'delivered')
        return this.finishDelivery(link, after, true);
      throw new ConflictException('This stop is already closed');
    }
    if (discrepancy) {
      await this.audit.logCtx(this.driverCtx(link), {
        action: 'delivery.cash_discrepancy',
        entityType: 'order',
        entityId: after.orderId as number,
        after: { expected: codExpected, collected, currency },
      });
    }
    return this.finishDelivery(link, after, false);
  }

  // Everything that follows a delivered stop, safe to repeat: record the cash on
  // the order through the single OrdersService.collectCash, move the order
  // through the SAME state machine staff use (CAS, audit, survey email), and
  // advance the run.
  private async finishDelivery(
    link: LinkContext,
    stop: RowDataPacket,
    idempotent: boolean,
  ) {
    const ctx = this.driverCtx(link);
    const orderId = stop.orderId as number;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT status, paymentMethod, cashCollectedAt FROM \`order\` WHERE id = ? AND shopId = ?`,
      [orderId, link.shopId],
    );
    const order = rows[0];
    if (
      order &&
      order.paymentMethod === 'cash_on_delivery' &&
      order.cashCollectedAt == null &&
      stop.cashCollectedAmount != null
    ) {
      await this.orders.collectCash(ctx, orderId);
    }
    if (order && order.status === 'out_for_delivery') {
      try {
        await this.orders.updateStatus(ctx, orderId, { status: 'delivered' });
      } catch (error) {
        const again = await this.db.query<RowDataPacket[]>(
          `SELECT status FROM \`order\` WHERE id = ? AND shopId = ?`,
          [orderId, link.shopId],
        );
        const status = again[0]?.status as string | undefined;
        if (status === 'delivered') {
          // a concurrent finisher won; fine
        } else if (status === 'cancelled') {
          await this.db.execute(
            `UPDATE deliveryrunstop SET status = 'failed', failureReason = 'order_not_deliverable', failedAt = NOW(3)
              WHERE id = ? AND shopId = ? AND status = 'delivered'`,
            [stop.id as number, link.shopId],
          );
          throw new ConflictException({
            statusCode: 409,
            code: 'order_not_deliverable',
            message: 'This order was cancelled. Do not hand it over',
          });
        } else {
          logger.error('driver delivery: order status move failed', {
            shopId: link.shopId,
            orderId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    }
    const runCompleted = await this.advanceRun(link);
    return {
      stopId: stop.id as number,
      status: 'delivered' as const,
      idempotent,
      runCompleted,
    };
  }

  private async advanceRun(link: LinkContext): Promise<boolean> {
    await this.db.execute(
      `UPDATE deliveryrun SET status = 'in_progress', updatedAt = NOW(3)
        WHERE id = ? AND shopId = ? AND status = 'dispatched'`,
      [link.runId, link.shopId],
    );
    return completeRunIfDone(poolExec(this.db), link.shopId, link.runId);
  }

  async fail(token: string | undefined, stopId: number, dto: FailStopDto) {
    const link = await this.resolve(token, 'write');
    const stop = await this.loadStop(link, stopId);
    if (stop.status === 'failed') {
      return {
        stopId,
        status: 'failed' as const,
        idempotent: true,
        runCompleted: false,
      };
    }
    if (stop.status !== 'pending') {
      throw new ConflictException('This stop is already closed');
    }
    const res = await this.db.execute(
      `UPDATE deliveryrunstop SET status = 'failed', failureReason = ?, failedAt = NOW(3),
              activeOrderId = NULL, otpHash = NULL, otpSalt = NULL, updatedAt = NOW(3)
        WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'`,
      [dto.reason, stopId, link.runId, link.shopId],
    );
    if (res.affectedRows === 0) {
      const again = await this.loadStop(link, stopId);
      if (again.status === 'failed') {
        return {
          stopId,
          status: 'failed' as const,
          idempotent: true,
          runCompleted: false,
        };
      }
      throw new ConflictException('This stop is already closed');
    }
    // The order is NOT moved: it stays out_for_delivery so staff can put it on a
    // new run (or cancel it). Stock is untouched. The attempt goes on the
    // order's timeline, attributed to the driver by label.
    await this.audit.logCtx(this.driverCtx(link), {
      action: 'order.delivery_failed',
      entityType: 'order',
      entityId: stop.orderId as number,
      after: { status: stop.orderStatus as string, reason: dto.reason },
    });
    const runCompleted = await this.advanceRun(link);
    return {
      stopId,
      status: 'failed' as const,
      idempotent: false,
      runCompleted,
    };
  }
}

export const MAX_OTP_ATTEMPTS = 5;
export const MAX_OTP_SENDS = 3;
export const OTP_TTL_MINUTES = 15;
