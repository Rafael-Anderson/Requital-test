import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';
import { ThemeConfigCache } from './theme-config-cache';

// JwtModule.register here (own registration, JWT_SECRET — same shared
// secret AuthModule uses for staff tokens, same convention
// CustomerAuthModule followed before its own phase-3 secret split) is what
// lets ThemesService mint the short-lived theme_preview token issuePreviewToken
// returns — see that method's own comment for why this exists at all
// (PreviewFrame.tsx can no longer read the real staff access token now that
// it's an httpOnly cookie).
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [ThemesController],
  providers: [ThemesService, ThemeConfigCache],
  // ThemesService is consumed by PublicModule (PublicService.getThemeConfig)
  // for the storefront-facing GET /public/:shopSlug/theme-config endpoint.
  exports: [ThemesService],
})
export class ThemesModule {}
