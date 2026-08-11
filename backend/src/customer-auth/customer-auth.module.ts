import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { JobsModule } from '../jobs/jobs.module';

// Same JWT secret as the staff AuthModule's JwtModule.register (one
// JWT_SECRET env var, shared) — what keeps the two token spaces from being
// interchangeable is the `typ` claim + guard checks, not a second secret.
// See CustomerAuthGuard's comment.
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
    JobsModule,
  ],
  controllers: [CustomerAuthController],
  providers: [CustomerAuthService, CustomerAuthGuard],
  // JwtModule itself must be exported too, not just CustomerAuthGuard —
  // @UseGuards(CustomerAuthGuard) in a *different* module (CustomerAccountModule)
  // re-resolves the guard's own constructor deps (JwtService, DatabaseService)
  // in that module's scope, so JwtService has to be visible there too.
  exports: [JwtModule, CustomerAuthGuard],
})
export class CustomerAuthModule {}
