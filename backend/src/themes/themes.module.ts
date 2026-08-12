import { Module } from '@nestjs/common';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';
import { ThemeConfigCache } from './theme-config-cache';

@Module({
  controllers: [ThemesController],
  providers: [ThemesService, ThemeConfigCache],
  // ThemesService is consumed by PublicModule (PublicService.getThemeConfig)
  // for the storefront-facing GET /public/:shopSlug/theme-config endpoint.
  exports: [ThemesService],
})
export class ThemesModule {}
