import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsWorkerService } from './jobs.worker.service';
import { JobsController } from './jobs.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  controllers: [JobsController],
  providers: [JobsService, JobsWorkerService, SchedulerService],
  exports: [JobsService, SchedulerService],
})
export class JobsModule {}
