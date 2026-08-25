import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { PlatformadminRow } from '../db/types';
import type { PlatformLoginDto } from './dto/platform-login.dto';

const TOKEN_LIFETIME = '12h';
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
// Same progressive-delay shape as AuthService's merchant login lockout (see
// that file's own comment for the reasoning) — copied rather than shared,
// since platformadmin and user are deliberately separate tables/tiers with
// no common base to hang a shared helper off without a premature abstraction.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_BASE_DELAY_SECONDS = 2;
const LOGIN_LOCKOUT_MAX_DELAY_SECONDS = 60;

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: PlatformLoginDto) {
    const admin = await this.findByEmail(dto.email);

    if (admin && this.isWithinLoginCooldown(admin)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      if (admin) {
        await this.db.execute(
          `UPDATE platformadmin SET failedLoginAttempts = failedLoginAttempts + 1, lastFailedLoginAt = ? WHERE id = ?`,
          [new Date(), admin.id],
        );
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.db.execute(
      `UPDATE platformadmin SET failedLoginAttempts = 0, lastFailedLoginAt = NULL, lastLoginAt = ? WHERE id = ?`,
      [new Date(), admin.id],
    );

    const accessToken = await this.jwtService.signAsync(
      { sub: admin.id, typ: 'platform' },
      { expiresIn: TOKEN_LIFETIME },
    );
    return {
      accessToken,
      accessTokenExpiresIn: TOKEN_LIFETIME_SECONDS,
      admin: this.toResponse(admin),
    };
  }

  private isWithinLoginCooldown(admin: {
    failedLoginAttempts: number;
    lastFailedLoginAt: Date | null;
  }): boolean {
    if (
      admin.failedLoginAttempts < LOGIN_LOCKOUT_THRESHOLD ||
      !admin.lastFailedLoginAt
    ) {
      return false;
    }
    const delaySeconds = Math.min(
      LOGIN_LOCKOUT_MAX_DELAY_SECONDS,
      LOGIN_LOCKOUT_BASE_DELAY_SECONDS **
        (admin.failedLoginAttempts - LOGIN_LOCKOUT_THRESHOLD + 1),
    );
    const elapsedMs = Date.now() - admin.lastFailedLoginAt.getTime();
    return elapsedMs < delaySeconds * 1000;
  }

  private async findByEmail(email: string): Promise<PlatformadminRow | null> {
    const rows = await this.db.query<(PlatformadminRow & RowDataPacket)[]>(
      `SELECT * FROM platformadmin WHERE email = ?`,
      [email],
    );
    return rows[0] ?? null;
  }

  private toResponse(admin: PlatformadminRow) {
    return { id: admin.id, email: admin.email, name: admin.name };
  }
}
