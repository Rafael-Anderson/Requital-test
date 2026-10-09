import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { hashToken } from '../common/token-hash';
import { trimDecimal } from '../database/decimal.util';
import { FixedWindowLimiter } from './fixed-window-limiter';
import { LINK_TOKEN_SHAPE } from './driver-link';

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

  constructor(private readonly db: DatabaseService) {}

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
}

export const MAX_OTP_ATTEMPTS = 5;
export const MAX_OTP_SENDS = 3;
