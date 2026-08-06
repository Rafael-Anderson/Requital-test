import { Module } from '@nestjs/common';
import { ThemeController } from './theme.controller';
import { ThemeService } from './theme.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ThemeController],
  providers: [ThemeService],
})
export class ThemeModule {}
