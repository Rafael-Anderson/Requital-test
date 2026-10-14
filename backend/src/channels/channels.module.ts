import { Module, OnModuleInit } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BranchRolesModule } from '../branch-roles/branch-roles.module';
import { CurrencyRatesModule } from '../currency-rates/currency-rates.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrderNotificationsModule } from '../orders/order-notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { ChannelConnectionsService } from './channel-connections.service';
import { ChannelIngestionService } from './channel-ingestion.service';
import { ChannelMappingsService } from './channel-mappings.service';
import { ChannelOrdersService } from './channel-orders.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import { ChannelSweepService } from './channel-sweep.service';
import { ChannelsController } from './channels.controller';
import { PlatformAuditLogService } from '../platform-admin/platform-audit-log.service';
import { StubChannelProvider } from './providers/stub-channel.provider';

// E2 (Deliveroo) and E3 (Talabat) register their providers on
// ChannelProviderRegistry from their own modules and call
// ChannelIngestionService.receive() from their webhook controllers.
function stubAllowed(): boolean {
  const env = process.env.NODE_ENV;
  return (
    env === 'test' ||
    env === 'development' ||
    process.env.ENABLE_STUB_CHANNEL === '1'
  );
}

@Module({
  imports: [
    AuditLogModule,
    BranchRolesModule,
    CurrencyRatesModule,
    JobsModule,
    OrderNotificationsModule,
    OrdersModule,
    ProductsModule,
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelProviderRegistry,
    ChannelConnectionsService,
    ChannelIngestionService,
    ChannelMappingsService,
    ChannelOrdersService,
    ChannelSweepService,
    StubChannelProvider,
    PlatformAuditLogService,
  ],
  exports: [
    ChannelProviderRegistry,
    ChannelIngestionService,
    ChannelConnectionsService,
  ],
})
export class ChannelsModule implements OnModuleInit {
  constructor(
    private readonly registry: ChannelProviderRegistry,
    private readonly stub: StubChannelProvider,
  ) {}

  onModuleInit(): void {
    // The stub claims a merchant-bound location proof, so it must never exist
    // in production (or staging with an unset NODE_ENV): allow-list, not
    // deny-list.
    if (stubAllowed()) {
      this.registry.register(this.stub);
    }
  }
}
