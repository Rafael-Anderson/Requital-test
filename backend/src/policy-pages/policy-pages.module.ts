import { Module } from '@nestjs/common';
import { PolicyPagesController } from './policy-pages.controller';
import { PolicyPagesService } from './policy-pages.service';

@Module({
  controllers: [PolicyPagesController],
  providers: [PolicyPagesService],
  // Consumed by PublicModule for the storefront's public policy-page route.
  exports: [PolicyPagesService],
})
export class PolicyPagesModule {}
