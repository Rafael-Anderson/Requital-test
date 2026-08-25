import { impersonateShop } from "./platform-api";
import { setTokens as setMerchantTokens } from "./api";

// Tracks "the merchant session currently in this tab is an impersonation of
// shop X" across the moment the session dies out from under RequireAuth
// (token expiry) — by the time that fires, AuthProvider's `user` is already
// null, so there's nothing left on `user.impersonating`/`user.shopId` to
// read. Set whenever a live session reports impersonating=true (see
// auth-context.tsx), read by RequireAuth to route an expired impersonation
// session to /impersonation-ended instead of /login, cleared once consumed
// or once a real (non-impersonating) session is active.
export const IMPERSONATION_SHOP_KEY = "requital_admin_impersonating_shop_id";

export function rememberImpersonatingShop(shopId: number) {
  localStorage.setItem(IMPERSONATION_SHOP_KEY, String(shopId));
}

export function forgetImpersonatingShop() {
  localStorage.removeItem(IMPERSONATION_SHOP_KEY);
}

export function getRememberedImpersonatingShopId(): string | null {
  return localStorage.getItem(IMPERSONATION_SHOP_KEY);
}

// Shared by the shops list and shop detail page so the confirm copy and the
// synchronous-navigation requirement live in exactly one place. Deliberately
// same-tab (not window.open) — window.open after an `await` is silently
// popup-blocked by most browsers (only a *synchronous* click-handler call
// is exempt), which was the actual bug behind "impersonation does nothing."
export async function startImpersonation(shopId: number): Promise<boolean> {
  const confirmed = window.confirm(
    "Log in as this shop's admin?\n\n" +
      "This opens the merchant admin as this shop's owner. Your session is logged and expires in 1 hour.",
  );
  if (!confirmed) return false;
  const session = await impersonateShop(shopId);
  setMerchantTokens({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken ?? "",
  });
  rememberImpersonatingShop(shopId);
  window.location.href = "/";
  return true;
}

export function confirmSuspend(): boolean {
  return window.confirm(
    "Suspend this shop?\n\n" +
      "This blocks merchant login and takes the storefront offline. It's reversible — you can unsuspend at any time.",
  );
}
