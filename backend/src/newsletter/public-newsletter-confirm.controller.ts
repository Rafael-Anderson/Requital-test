import { Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { NewsletterConfirmService } from './newsletter-confirm.service';

// Un-slugged like the survey and tracking routes: the token alone identifies the
// row. GET never changes state (a mail scanner may open it); POST confirms.
@Controller('public/newsletter')
export class PublicNewsletterConfirmController {
  constructor(private readonly service: NewsletterConfirmService) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Get('confirm')
  lookup(@Query('token') token?: string) {
    return this.service.lookup(token);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Post('confirm')
  confirm(@Query('token') token?: string) {
    return this.service.confirm(token);
  }
}
