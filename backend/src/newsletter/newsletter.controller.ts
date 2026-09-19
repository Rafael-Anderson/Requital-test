import { Controller, Get, Query } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { ListNewsletterSubscribersQueryDto } from './dto/list-newsletter-subscribers-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Read-only. Subscriber emails are shop-wide PII, so this follows the same
// admin+viewer read tier CustomersController uses rather than being visible
// to a branch account, which has no shop-wide slice of its own.
//
// The matching WRITE endpoint is deliberately elsewhere: it is public and
// lives in PublicService with the rest of the storefront surface.
@Controller('newsletter-subscribers')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Roles('admin', 'viewer')
  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListNewsletterSubscribersQueryDto,
  ) {
    return this.newsletterService.findAll(ctx, query);
  }
}
