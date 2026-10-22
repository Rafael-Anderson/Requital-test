import { Module } from '@nestjs/common';
import {
  MapsHealthController,
  PublicMapsHealthController,
} from './maps-health.controller';
import { MapsHealthService } from './maps-health.service';

@Module({
  controllers: [MapsHealthController, PublicMapsHealthController],
  providers: [MapsHealthService],
})
export class MapsHealthModule {}
