import { Module } from '@nestjs/common';
import { WhatsAppSettingsController } from './whatsapp-settings.controller';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';

@Module({
  controllers: [WhatsAppSettingsController],
  providers: [WhatsAppSettingsService, MetaWhatsAppProvider],
  exports: [WhatsAppSettingsService, MetaWhatsAppProvider],
})
export class WhatsAppModule {}
