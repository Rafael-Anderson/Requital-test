import { Module } from '@nestjs/common';
import { CurrencyRatesService } from './currency-rates.service';

// No controller of its own — the only write surface is the platform-admin tier
// (rates are a platform fact, not a tenant one), so PlatformAdminModule owns the
// routes and this module just exports the service.
@Module({
  providers: [CurrencyRatesService],
  exports: [CurrencyRatesService],
})
export class CurrencyRatesModule {}
