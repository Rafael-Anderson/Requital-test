import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  // No secret registered: every sign/verify here passes its own derived one.
  imports: [JwtModule.register({}), AuditLogModule],
  controllers: [TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
