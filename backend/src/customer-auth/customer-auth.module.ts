import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { JobsModule } from '../jobs/jobs.module';

// Session-cookie migration (security audit finding #1), phase 3 — this used
// to share JWT_SECRET with the staff AuthModule, relying only on the `typ`
// claim + guard checks to keep the two token spaces from being
// interchangeable. Now genuinely separate, same shape as platform admin's
// own PLATFORM_JWT_SECRET: a customer token fails signature verification
// outright against the staff AuthGuard's JwtService (and vice versa),
// rather than relying solely on a claim a guard could someday forget to
// check. The `typ: 'customer'` check in CustomerAuthGuard stays as defense
// in depth on top of this, not the only protection anymore.
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.CUSTOMER_JWT_SECRET,
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
