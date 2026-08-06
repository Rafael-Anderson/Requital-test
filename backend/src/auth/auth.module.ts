import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { JobsModule } from '../jobs/jobs.module';

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
    JobsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards run in registration order — see
    // https://docs.nestjs.com/guards#binding-guards. ThrottlerGuard goes
    // first so an over-limit request is rejected before AuthGuard even
    // re-fetches the user from the DB (matters most for @Public() routes
    // like login/signup, which AuthGuard doesn't otherwise gate at all).
    // AuthGuard (bearer token -> TenantContext) then runs before RolesGuard
    // (admin-only route check).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
