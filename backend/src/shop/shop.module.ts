import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { DnsResolver } from './dns-resolver';
import { CustomDomainVerificationService } from './custom-domain-verification.service';
import { StorageModule } from '../storage/storage.module';
import { JobsModule } from '../jobs/jobs.module';
import { DomainsModule } from '../domains/domains.module';

@Module({
  // JobsModule exports SchedulerService (the cross-instance advisory lock the
  // custom-domain verification sweep runs under); DomainsModule exports
  // DomainsService for resolve-cache invalidation on domain state changes.
  imports: [StorageModule, JobsModule, DomainsModule],
  controllers: [ShopController],
  providers: [ShopService, DnsResolver, CustomDomainVerificationService],
  // PaymentsModule reuses this for the COD toggle on the Payment Gateways
  // settings page — same shop.deliveryPaymentCashOnDelivery/
  // pickupPaymentCashOnPickup fields ShopService.update already validates
  // ("at least one payment method"), not a parallel write path around it.
  exports: [ShopService],
})
export class ShopModule {}
