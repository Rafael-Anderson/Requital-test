import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

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
  providers: [PlatformAuthService, PlatformAdminGuard],
  // JwtModule + PlatformAdminGuard both need to be visible wherever
  // @UseGuards(PlatformAdminGuard) is applied in another module (same
  // reason CustomerAuthModule exports both — see that module's comment).
  exports: [JwtModule, PlatformAdminGuard],
})
export class PlatformAuthModule {}
