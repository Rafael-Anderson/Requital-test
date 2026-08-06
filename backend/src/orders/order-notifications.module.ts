import { Module } from '@nestjs/common';
import { OrderNotificationsService } from './order-notifications.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [WhatsAppModule, JobsModule],
  providers: [OrderNotificationsService],
  exports: [OrderNotificationsService],
})
export class OrderNotificationsModule {}
