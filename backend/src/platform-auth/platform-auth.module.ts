import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformTwoFactorService } from './platform-two-factor.service';
import { PlatformAuditLogService } from '../platform-admin/platform-audit-log.service';

// A completely separate secret from the merchant AuthModule's JwtModule.
// register — this is what makes a merchant token and a platform token
// structurally unable to verify against each other, not just the `typ`
// claim check (defense in depth, see PlatformAdminGuard's own comment).
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.PLATFORM_JWT_SECRET,
    }),
  ],
  controllers: [PlatformAuthController],
  providers: [
    PlatformAuthService,
    PlatformAdminGuard,
    PlatformTwoFactorService,
    // Stateless (db only); provided here too so enrolment can be audited
    // without PlatformAuthModule importing PlatformAdminModule (a cycle).
    PlatformAuditLogService,
  ],
  // JwtModule + PlatformAdminGuard both need to be visible wherever
  // @UseGuards(PlatformAdminGuard) is applied in another module (same
  // reason CustomerAuthModule exports both — see that module's comment).
  exports: [JwtModule, PlatformAdminGuard],
})
export class PlatformAuthModule {}
