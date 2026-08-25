import { Module } from '@nestjs/common';
import { WebhookLogController } from './webhook-log.controller';
import { WebhookLogService } from './webhook-log.service';

@Module({
  controllers: [WebhookLogController],
  providers: [WebhookLogService],
  exports: [WebhookLogService],
})
export class WebhookLogModule {}
