import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// No providers of its own — PrismaService comes from the @Global()
// PrismaModule (see prisma/prisma.module.ts), injectable anywhere without
// re-importing it here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
