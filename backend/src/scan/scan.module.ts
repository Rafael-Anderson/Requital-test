import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanSettingsService } from './scan-settings.service';
import { OcrService } from './ocr.service';
import { StorageModule } from '../storage/storage.module';
import { NotifySubscriptionsModule } from '../notify-subscriptions/notify-subscriptions.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [StorageModule, NotifySubscriptionsModule, ProductsModule],
  controllers: [ScanController],
  providers: [ScanService, ScanSettingsService, OcrService],
})
export class ScanModule {}
