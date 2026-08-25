import { UnauthorizedException } from '@nestjs/common';

// Minimal platform-admin auth: a single shared secret (PLATFORM_ADMIN_TOKEN),
// checked against the X-Platform-Admin-Token header — deliberately not the
// shop-scoped JWT/RolesGuard system (a shop admin's token is fundamentally
// shop-scoped and must never authorize a cross-shop write like this one).
// No platform-admin user/role model exists in this codebase yet; this is
// the same "simple shared platform secret" shape as SLIDER_WEBHOOK_TOKEN/
// CREDENTIAL_ENCRYPTION_KEY, not a new auth system. See CLAUDE.md — this is
// explicitly a placeholder pending a real platform admin UI/role.
export function assertPlatformAdminToken(token: string | undefined): void {
  const expected = process.env.PLATFORM_ADMIN_TOKEN;
  if (!expected) {
    throw new UnauthorizedException(
      'PLATFORM_ADMIN_TOKEN is not configured — platform-admin routes are disabled',
    );
  }
  if (!token || token !== expected) {
    throw new UnauthorizedException('Invalid platform admin token');
  }
}
