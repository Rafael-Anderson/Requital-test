import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { UrlRedirectsController } from './url-redirects.controller';
import { PublicUrlRedirectsController } from './public-url-redirects.controller';
import { UrlRedirectsService } from './url-redirects.service';

@Module({
  imports: [AuditLogModule],
  controllers: [UrlRedirectsController, PublicUrlRedirectsController],
  providers: [UrlRedirectsService],
})
export class UrlRedirectsModule {}
