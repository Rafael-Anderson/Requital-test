import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

@Module({
  controllers: [DomainsController],
  providers: [DomainsService],
  // ShopModule imports this so ShopService.updateDomain and
  // CustomDomainVerificationService.verifyClaim can invalidate the
  // resolve cache on a connect / disconnect / verify.
  exports: [DomainsService],
})
export class DomainsModule {}
