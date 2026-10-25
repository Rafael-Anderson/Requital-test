import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  MapsHealthController,
  PublicMapsHealthController,
} from './maps-health.controller';
import { MapsHealthService } from './maps-health.service';

@Module({
  imports: [AuditLogModule],
  controllers: [MapsHealthController, PublicMapsHealthController],
  providers: [MapsHealthService],
})
export class MapsHealthModule {}
