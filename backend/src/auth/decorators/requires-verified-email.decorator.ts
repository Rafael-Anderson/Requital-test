import { SetMetadata } from '@nestjs/common';

export const REQUIRES_VERIFIED_EMAIL_KEY = 'requiresVerifiedEmail';

export interface RequiresVerifiedEmailOptions {
  // Merchant-facing wording for the 403, naming the action being blocked.
  // The banner in the admin explains how to verify; this says what was
  // refused and why.
  action: string;
  // Only enforce when the request body carries this `type` value. Exists for
  // PATCH /shop/domain, where connecting a CUSTOM domain is the action worth
  // gating but switching back to a plain subdomain is a de-escalation nobody
  // should be locked out of.
  whenBodyType?: string;
}

// Staff/merchant tier only. Deliberately not applied to any customer or
// platform-admin route: shoppers check out as guests by design (gating them
// would block real sales), and platform admins have no signup at all - they
// are seeded from the CLI, so there is no unverified state to gate.
export const RequiresVerifiedEmail = (options: RequiresVerifiedEmailOptions) =>
  SetMetadata(REQUIRES_VERIFIED_EMAIL_KEY, options);
