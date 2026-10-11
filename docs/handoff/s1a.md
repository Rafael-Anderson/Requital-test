# S1a handoff: platform-admin reset of a shop user's two-factor

Branch `feat/platform-2fa-reset`. Migration `20261024100000_user_must_enrol_2fa` (user.mustEnrol2fa TINYINT(1) NOT NULL DEFAULT 0).

## Design (file evidence)
- Endpoints: `GET /platform-admin/shops/:shopId/users`, `POST /platform-admin/shops/:shopId/users/:userId/reset-2fa` (`platform-admin.controller.ts`, class-level `@Public() @UseGuards(PlatformAdminGuard)`; throttle 5/min on the reset; platform CSRF via `forRoutes('platform-auth','platform-admin')`, app.module.ts:264).
- Reset = `PlatformAdminService.resetShopUserTwoFactor`: ONE `db.transaction`; every statement on `conn`: `SELECT ... FROM user WHERE id=? AND shopId=? FOR UPDATE` (404 `User not found` for missing OR other shop, same body), `MfaStore.disableOn(conn)` (new, `disable()` now delegates to it), flag set only if the user had a CONFIRMED second factor, revoke all unrevoked refreshtoken rows, `jobs.enqueue(..., {tx: conn})` for the email, `platformAuditLogService.log(..., conn)` last (a throw rolls everything back). `check-nested-pool.js` passes.
- Enforcement: `AuthGuard` same single query now selects `u.mustEnrol2fa`; confinement condition `(shopRequires2fa || mustEnrol2fa) && !mfaEnrolled && !@AllowPendingMfa && !impersonation` (auth.guard.ts). Default deny unchanged. The flag only matters while NOT enrolled, so a stale 1 on an enrolled user is inert.
- Clearing: `MfaStore.confirmEnrollment(..., onConfirmed)`; `TwoFactorService.confirmEnrollment` passes a callback that runs `UPDATE user SET mustEnrol2fa = 0` on the SAME transaction that sets `confirmedAt`.
- `/auth/me` `twoFactor.enrollmentRequired` is true for a flagged user (`meState`), so the admin app's existing RequireAuth redirect to /settings/security works unchanged (copy no longer says "your shop").
- PLATFORM_REQUIRE_2FA: PlatformAdminGuard already applies to every non-`@AllowPendingMfa` handler of the controller, so an unenrolled platform admin gets 403 `mfa_enrollment_required` on both new routes (tested).
- Response `{ success: true }` only; the list selects explicit columns (no hash/secret/code/token), `lastSignInAt` = MAX(refreshtoken.createdAt).

## Decisions / deviations to review
1. **No shop-side `auditlog` row.** `auditlog.actorUserId` is NOT NULL with an FK to `user`; a platform admin is not a user, and faking the target as actor would lie. The platform audit row + the email to the user are the trail. (adminReset's same-shop row is unchanged.)
2. Sessions of a user who was NOT enrolled are still revoked (reset = sign out everywhere), flag stays 0. Audit metadata records `wasEnrolled`.
3. Impersonation tokens (no refresh row, exempt from confinement by existing design) are not revoked by the reset; they expire within 1 hour. A platform admin impersonating cannot call these routes anyway (different cookie/guard).
4. Pre-existing, NOT changed: an unauthenticated POST to any `/platform-admin/*` route answers 403 (CSRF middleware runs before the guard), not 404. GETs are 404.
5. The same-shop `adminReset` (admin resets colleague) does NOT set the flag: in a shop that does not require 2FA the colleague simply ends up unenrolled. Left alone (out of scope), say if you want it to share this path.
6. The reset email is queued in the transaction with a random idempotency key per reset (each reset notifies). No codes/secrets in it.
7. CardList is merchant-light styled; the platform chrome is dark slate, so the card uses the `CardList` wrapper (md:hidden list) with dark `li`s rather than `CardListItem`.
8. After a reset a person with only the password can enrol their own device; that is inherent and is why the runbook checklist exists.

## Adversarial checklist (for the independent review)
- [ ] Cross-tenant: reset with shop A id + shop B user id (404, B untouched: TOTP rows, flag, sessions, no audit row) and list for A never shows B. Tested.
- [ ] Merchant token / staff cookie / no token / platform session without CSRF cannot reach it. Tested.
- [ ] Audit failure rolls back TOTP delete, flag, session revoke and the email job. Tested (mocks `PlatformAuditLogService.log` rejecting AFTER the other statements, so rollback is proven).
- [ ] Nothing inside the transaction touches the pool (tool passes). `jobs.enqueue` gets `tx`. A duplicate-key retry path in enqueue would use the pool but the key is a random UUID.
- [ ] TOCTOU: the user row is `FOR UPDATE`; a concurrent enrolment confirm for the same user waits, then either confirms before (and is then removed) or after (and flag is already 1, cleared by that confirm: user ends enrolled, flag 0, which is a legitimate re-enrolment). A concurrent login mid-reset: refresh token inserted after our revoke survives; its access is still confined if flagged. Residual: in a NON-required shop, an unenrolled user's session created concurrently with the reset survives (flag 0). Accepted.
- [ ] An attacker with the reset (platform admin) can enrol their own TOTP only with the user's password (startEnrollment needs current password) -> reset does not give account takeover by itself.
- [ ] Flagged user cannot reach: /products, /auth/sessions, disable, regenerate, shop-policy (all 403). Allowed: /auth/me, GET /auth/2fa, enroll start/confirm. Logout/refresh are not guard-confined by this change (unchanged behaviour for require2fa).
- [ ] mfaToken minted before the reset is useless after (no usertotp row -> 401 on verify).
- [ ] Response/log: no secret fields (tested by key list and JSON scan).
- [ ] Injection proofs: no-revoke, no-shopId, audit-outside-transaction, no-AuthGuard-confinement, no-flag-clear each fail the named tests.
