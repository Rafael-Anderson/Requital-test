import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanSettingsService } from './scan-settings.service';
import { OcrService } from './ocr.service';

@Module({
  controllers: [ScanController],
  providers: [ScanService, ScanSettingsService, OcrService],
})
export class ScanModule {}
