import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import type { DatabaseService } from '../database/database.service';
import { decrypt, encrypt } from '../common/crypto';
import { verifyTotp } from './totp';
import {
  findRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
} from './recovery-codes';

// Everything stateful about a second factor, shared by the staff tier
// (usertotp / userrecoverycode) and the platform-admin tier
// (platformadmintotp / platformadminrecoverycode). Two tiers, one
// implementation: the table and id column are fixed constants below, never
// derived from input.
export type MfaTier = 'staff' | 'platform';
const TABLES = {
  staff: { totp: 'usertotp', recovery: 'userrecoverycode', id: 'userId' },
  platform: {
    totp: 'platformadmintotp',
    recovery: 'platformadminrecoverycode',
    id: 'platformAdminId',
  },
} as const;

// 5 wrong codes (TOTP and recovery codes counted together) lock verification
// for 15 minutes. A lock is a DELAY for someone who already has the password,
// not an account lockout: the password step is unaffected.
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MINUTES = 15;

interface TotpRow extends RowDataPacket {
  secretEnc: string;
  confirmedAt: Date | null;
  lastStep: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export class MfaStore {
  private readonly t: (typeof TABLES)[MfaTier];
  constructor(
    private readonly db: DatabaseService,
    tier: MfaTier,
  ) {
    this.t = TABLES[tier];
  }

  private async row(id: number): Promise<TotpRow | null> {
    const rows = await this.db.query<TotpRow[]>(
      `SELECT secretEnc, confirmedAt, lastStep, failedAttempts, lockedUntil
       FROM ${this.t.totp} WHERE ${this.t.id} = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async isEnrolled(id: number): Promise<boolean> {
    return !!(await this.row(id))?.confirmedAt;
  }

  async status(id: number) {
    const r = await this.row(id);
    const remaining = r?.confirmedAt ? await this.remainingCodes(id) : 0;
    return {
      enabled: !!r?.confirmedAt,
      pendingEnrollment: !!r && !r.confirmedAt,
      recoveryCodesRemaining: remaining,
    };
  }

  async remainingCodes(id: number): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${this.t.recovery} WHERE ${this.t.id} = ? AND usedAt IS NULL`,
      [id],
    );
    return Number(rows[0].c);
  }

  // Starts (or restarts) an UNCONFIRMED enrollment. A confirmed secret is never
  // touched here: replacing a live second factor goes through disable().
  // Returns false when one is already confirmed.
  async beginEnrollment(id: number, secretBase32: string): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT INTO ${this.t.totp} (${this.t.id}, secretEnc) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         secretEnc = IF(confirmedAt IS NULL, VALUES(secretEnc), secretEnc),
         failedAttempts = IF(confirmedAt IS NULL, 0, failedAttempts),
         lockedUntil = IF(confirmedAt IS NULL, NULL, lockedUntil)`,
      [id, encrypt(secretBase32)],
    );
    // 1 = inserted, 2 = updated an unconfirmed row, 0 = row left as it was
    // (confirmed, or an identical write)
    return result.affectedRows !== 0;
  }

  // Confirms a pending enrollment with a valid code from the new secret, and
  // issues the one-time recovery codes in the same transaction. Returns them
  // (plaintext, shown once), or null when there is nothing pending.
  async confirmEnrollment(
    id: number,
    code: string,
    nowMs: number,
    // Runs on the confirming transaction (staff tier: clears user.mustEnrol2fa).
    onConfirmed?: (conn: PoolConnection) => Promise<void>,
  ): Promise<string[] | null> {
    const r = await this.row(id);
    if (!r || r.confirmedAt) return null;
    await this.assertNotLocked(id, r);
    const step = verifyTotp(decrypt(r.secretEnc), code, nowMs);
    if (step === null) {
      await this.recordFailure(id);
      throw new UnauthorizedException({
        statusCode: 401,
        message:
          'That code is not valid. Check the time on your device and try again.',
        code: 'mfa_invalid',
      });
    }
    const codes = generateRecoveryCodes();
    const won = await this.db.transaction(async (conn) => {
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE ${this.t.totp} SET confirmedAt = ?, lastStep = ?, failedAttempts = 0, lockedUntil = NULL
         WHERE ${this.t.id} = ? AND confirmedAt IS NULL`,
        [new Date(), step, id],
      );
      if (res.affectedRows === 0) return false;
      await this.replaceRecoveryCodes(conn, id, codes);
      await onConfirmed?.(conn);
      return true;
    });
    return won ? codes : null;
  }

  // Accepts a current TOTP code or an unused recovery code. Throws 401
  // (generic) on a wrong one and 429 while locked. A TOTP step already
  // accepted once is rejected (replay), and a recovery code is consumed by a
  // single compare-and-set, so concurrent use of one code has exactly one
  // winner.
  async verify(
    id: number,
    input: string,
    nowMs: number,
  ): Promise<'totp' | 'recovery'> {
    const r = await this.row(id);
    if (!r?.confirmedAt) throw this.invalid();
    await this.assertNotLocked(id, r);

    const trimmed = input.trim();
    let kind: 'totp' | 'recovery' | null = null;
    if (/^\d{6}$/.test(trimmed)) {
      const step = verifyTotp(decrypt(r.secretEnc), trimmed, nowMs);
      if (step !== null) {
        const res = await this.db.execute(
          `UPDATE ${this.t.totp} SET lastStep = ?
           WHERE ${this.t.id} = ? AND (lastStep IS NULL OR lastStep < ?)`,
          [step, id, step],
        );
        if (res.affectedRows === 1) kind = 'totp';
      }
    } else if (looksLikeRecoveryCode(trimmed)) {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, codeHash FROM ${this.t.recovery} WHERE ${this.t.id} = ? AND usedAt IS NULL`,
        [id],
      );
      const idx = findRecoveryCode(
        trimmed,
        rows.map((x) => x.codeHash as string),
      );
      if (idx !== -1) {
        const res = await this.db.execute(
          `UPDATE ${this.t.recovery} SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
          [new Date(), rows[idx].id],
        );
        if (res.affectedRows === 1) kind = 'recovery';
      }
    }

    if (kind === null) {
      await this.recordFailure(id);
      throw this.invalid();
    }
    await this.db.execute(
      `UPDATE ${this.t.totp} SET failedAttempts = 0, lockedUntil = NULL WHERE ${this.t.id} = ?`,
      [id],
    );
    return kind;
  }

  // New set of recovery codes; the old ones stop working in the same
  // transaction.
  async regenerateRecoveryCodes(id: number): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.db.transaction((conn) =>
      this.replaceRecoveryCodes(conn, id, codes),
    );
    return codes;
  }

  // Removes the second factor entirely (own disable, admin reset).
  async disable(id: number): Promise<void> {
    await this.db.transaction((conn) => this.disableOn(conn, id));
  }

  // The same removal on a caller's transaction (platform-admin reset).
  async disableOn(conn: PoolConnection, id: number): Promise<void> {
    await conn.query(`DELETE FROM ${this.t.recovery} WHERE ${this.t.id} = ?`, [
      id,
    ]);
    await conn.query(`DELETE FROM ${this.t.totp} WHERE ${this.t.id} = ?`, [id]);
  }

  private async replaceRecoveryCodes(
    conn: PoolConnection,
    id: number,
    codes: string[],
  ) {
    await conn.query(`DELETE FROM ${this.t.recovery} WHERE ${this.t.id} = ?`, [
      id,
    ]);
    await conn.query(
      `INSERT INTO ${this.t.recovery} (${this.t.id}, codeHash) VALUES ${codes.map(() => '(?, ?)').join(', ')}`,
      codes.flatMap((c) => [id, hashRecoveryCode(c)]),
    );
  }

  private async assertNotLocked(id: number, r: TotpRow) {
    if (!r.lockedUntil) return;
    if (r.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(
        1,
        Math.ceil((r.lockedUntil.getTime() - Date.now()) / 60000),
      );
      throw new HttpException(
        {
          statusCode: 429,
          message: `Too many incorrect codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          code: 'mfa_locked',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // lock elapsed: start counting from zero again
    await this.db.execute(
      `UPDATE ${this.t.totp} SET failedAttempts = 0, lockedUntil = NULL
       WHERE ${this.t.id} = ? AND lockedUntil <= ?`,
      [id, new Date()],
    );
  }

  // One statement: the increment and the decision to lock are atomic. The
  // lockedUntil assignment must come FIRST: MySQL applies SET assignments left
  // to right, so a later expression would see the already-incremented counter.
  private async recordFailure(id: number) {
    const lockUntil = new Date(Date.now() + MFA_LOCK_MINUTES * 60000);
    await this.db.execute(
      `UPDATE ${this.t.totp}
       SET lockedUntil = IF(failedAttempts + 1 >= ?, ?, lockedUntil),
           failedAttempts = failedAttempts + 1
       WHERE ${this.t.id} = ?`,
      [MFA_MAX_FAILURES, lockUntil, id],
    );
  }

  private invalid() {
    return new UnauthorizedException({
      statusCode: 401,
      message: 'That code is not valid.',
      code: 'mfa_invalid',
    });
  }
}
