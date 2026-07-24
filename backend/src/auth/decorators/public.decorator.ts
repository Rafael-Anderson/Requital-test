import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route as reachable without a bearer token — AuthGuard checks this
// before requiring one. Kept to the small, deliberate set of routes that
// genuinely aren't a merchant session: signup, login, the token-authenticated
// storefront checkout, and the signature-authenticated Stripe webhook.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
