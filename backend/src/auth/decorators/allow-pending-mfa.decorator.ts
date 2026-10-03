import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_MFA_KEY = 'allowPendingMfa';

// Marks a route as callable by a session that still has to set up two-factor
// (its shop, or for platform admins the PLATFORM_REQUIRE_2FA switch, requires
// it). Default deny: AuthGuard / PlatformAdminGuard refuse every other route
// for such a session until it is enrolled.
export const AllowPendingMfa = () => SetMetadata(ALLOW_PENDING_MFA_KEY, true);
