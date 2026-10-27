import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { NewsletterConfirmService } from './newsletter-confirm.service';
import { PublicNewsletterConfirmController } from './public-newsletter-confirm.controller';

@Module({
  imports: [JobsModule],
  controllers: [NewsletterController, PublicNewsletterConfirmController],
  providers: [NewsletterService, NewsletterConfirmService],
  exports: [NewsletterConfirmService],
})
export class NewsletterModule {}
