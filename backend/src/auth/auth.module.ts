import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';

// The access-token lifetime itself is set per-call in AuthService.issueTokenPair
// (ACCESS_TOKEN_LIFETIME) — refresh-token rotation means a short-lived access
// token is cheap to re-issue, so this module-level default only matters as a
// fallback for any future signAsync() call site that forgets to override it.
const DEFAULT_TOKEN_LIFETIME = '15m';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: DEFAULT_TOKEN_LIFETIME },
    }),
    AuditLogModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards: AuthGuard (bearer token -> TenantContext) runs before
    // RolesGuard (admin-only route check) on every request, in registration
    // order — see https://docs.nestjs.com/guards#binding-guards.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
