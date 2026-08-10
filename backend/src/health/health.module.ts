import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// No providers of its own — DatabaseService comes from the @Global()
// DatabaseModule (see database/database.module.ts), injectable anywhere
// without re-importing it here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
