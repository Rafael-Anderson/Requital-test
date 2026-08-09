import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [MenuController],
  providers: [MenuService],
  // PublicModule needs this for the storefront's read-only GET
  // /public/:shopSlug/menu route.
  exports: [MenuService],
})
export class MenuModule {}
