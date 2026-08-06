import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanSettingsService } from './scan-settings.service';
import { OcrService } from './ocr.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ScanController],
  providers: [ScanService, ScanSettingsService, OcrService],
})
export class ScanModule {}
