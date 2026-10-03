import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { MfaStore } from '../two-factor/mfa-store';
import { generateTotpSecret, otpauthUri } from '../two-factor/totp';
import { PlatformAuditLogService } from '../platform-admin/platform-audit-log.service';

const ISSUER = 'Requital Platform';
const MFA_TOKEN_LIFETIME = '5m';

// Same construction as the staff tier's (see two-factor.service.ts) but keyed
// off PLATFORM_JWT_SECRET with its own label: a staff pending-login token, a
// platform pending-login token, and a platform session token all fail
// signature verification against each other's verifiers.
export function platformMfaSecret(): string {
  return createHmac('sha256', process.env.PLATFORM_JWT_SECRET ?? '')
    .update('platform-mfa-token-v1')
    .digest('hex');
}

const fingerprint = (passwordHash: string) =>
  createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);

// Platform admins are CLI-seeded and there is no signup, so the tier keeps that
// model: a second factor is self-service for any platform admin who wants it
// and is ENFORCED at login for every admin who has enrolled. Whether a
// not-yet-enrolled admin may keep working is the PLATFORM_REQUIRE_2FA switch
// (default off, so deploying this cannot lock the only admin out; flip it once
// the admins have enrolled).
export function platformRequires2fa(): boolean {
  return ['1', 'true', 'on'].includes(
    (process.env.PLATFORM_REQUIRE_2FA ?? '').toLowerCase(),
  );
}

@Injectable()
export class PlatformTwoFactorService {
  private readonly store: MfaStore;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditLogService,
  ) {
    this.store = new MfaStore(db, 'platform');
  }

  isEnrolled(id: number) {
    return this.store.isEnrolled(id);
  }

  issueMfaToken(admin: { id: number; passwordHash: string }) {
    return this.jwt.signAsync(
      {
        sub: admin.id,
        typ: 'platform_mfa',
        pwf: fingerprint(admin.passwordHash),
      },
      { secret: platformMfaSecret(), expiresIn: MFA_TOKEN_LIFETIME },
    );
  }

  async readMfaToken(token: string): Promise<{ adminId: number; pwf: string }> {
    let p: { sub: number; typ?: string; pwf?: string };
    try {
      p = await this.jwt.verifyAsync(token, { secret: platformMfaSecret() });
    } catch {
      throw new UnauthorizedException('Your sign-in expired. Start again.');
    }
    if (p.typ !== 'platform_mfa' || typeof p.sub !== 'number' || !p.pwf) {
      throw new UnauthorizedException('Your sign-in expired. Start again.');
    }
    return { adminId: p.sub, pwf: p.pwf };
  }

  matchesPassword(pwf: string, passwordHash: string) {
    return pwf === fingerprint(passwordHash);
  }

  verifyLoginCode(adminId: number, code: string) {
    return this.store.verify(adminId, code, Date.now());
  }

  async status(adminId: number) {
    return {
      ...(await this.store.status(adminId)),
      required: platformRequires2fa(),
    };
  }

  async startEnrollment(adminId: number, currentPassword: string) {
    const admin = await this.adminRow(adminId);
    if (
      !(await bcrypt.compare(currentPassword, admin.passwordHash as string))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const secret = generateTotpSecret();
    if (!(await this.store.beginEnrollment(adminId, secret))) {
      throw new ConflictException(
        'Two-factor is already on. Turn it off first to set up a new device.',
      );
    }
    return {
      secret,
      otpauthUri: otpauthUri({
        issuer: ISSUER,
        account: admin.email as string,
        secret,
      }),
    };
  }

  async confirmEnrollment(adminId: number, code: string) {
    const codes = await this.store.confirmEnrollment(adminId, code, Date.now());
    if (!codes) {
      throw new BadRequestException(
        'There is no set-up in progress. Start again.',
      );
    }
    await this.audit.log(adminId, 'platform.2fa_enabled', null);
    return { recoveryCodes: codes };
  }

  async disable(adminId: number, code: string) {
    if (platformRequires2fa()) {
      throw new ForbiddenException(
        'Platform sign-in requires two-factor authentication, so it cannot be turned off.',
      );
    }
    await this.store.verify(adminId, code, Date.now());
    await this.store.disable(adminId);
    await this.audit.log(adminId, 'platform.2fa_disabled', null);
    return { success: true };
  }

  async regenerateRecoveryCodes(
    adminId: number,
    currentPassword: string,
    code: string,
  ) {
    const admin = await this.adminRow(adminId);
    if (
      !(await bcrypt.compare(currentPassword, admin.passwordHash as string))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.store.verify(adminId, code, Date.now());
    const codes = await this.store.regenerateRecoveryCodes(adminId);
    await this.audit.log(
      adminId,
      'platform.2fa_recovery_codes_regenerated',
      null,
    );
    return { recoveryCodes: codes };
  }

  private async adminRow(id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, email, passwordHash FROM platformadmin WHERE id = ?`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
}
