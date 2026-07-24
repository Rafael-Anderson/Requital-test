import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';

const TOKEN_LIFETIME = '7d';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: TOKEN_LIFETIME },
    }),
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
