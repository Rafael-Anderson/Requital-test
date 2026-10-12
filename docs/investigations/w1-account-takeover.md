# W1: guest checkout account takeover (branch fix/guest-checkout-account-takeover)

## The chain, verified on main 7024a6d7 (file:line at that commit)

1. `customers.service.ts` `findOrCreateForOrder` matched `[shopId, phone]` (and then the
   `customermerge` alias) and passed the match to `applyUpdateIfChanged`, which wrote the
   typed `name` and `email` onto the customer row. Phone is not a credential.
2. `customer-auth.service.ts` `forgotPassword` selected `shopId + email AND passwordHash IS NOT NULL`
   and mailed the link to `customer.email`.
3. So: victim registers (email V). Attacker guest-checks-out with the victim's phone and email A,
   then `POST /public/:slug/auth/forgot-password {email: A}`, gets a link to A, sets a password,
   and owns the account (and any store credit; the store-credit spend path is the logged-in session).
   Reproduced by `test/customer-takeover.e2e-spec.ts` ("TAKEOVER ..."), which fails on main.

Premise check: all of it is right. Two additions to the brief:
* The order notifications already read `order.customerEmail` (the typed address on the order row),
  not the customer record, so "the order keeps what was typed for that order" needed no change there.
* The `emailVerified` BOOLEAN column on `customer` (migration 20260727100000) is **never written by any code**
  (every row is 0). It is left alone and no longer read; the API's `emailVerified` is now derived.

## Other writers of customer.email / name / phone (all checked)

| Path | Verdict |
|---|---|
| public `createOrder`, `OrdersService.create`, draft order complete, merged-phone alias, concurrent-create race | all go through `findOrCreateForOrder`; fixed once there. A match is returned unchanged; only an unknown phone creates a row. |
| abandoned-cart capture | writes `abandonedcart` only (tested). |
| back-in-stock, newsletter | own tables only (tested). |
| S3 customer import | admin only; only fills an EMPTY email (`email IS NULL`). Harmless now: an email does not authorise a reset. |
| admin `PATCH /customers/:id` | staff; sets `email` (unproven). Cannot touch `verifiedEmail`. |
| customer merge | copies `primary.email ?? dup.email`; unproven. A duplicate with an account is refused already. |
| account profile update | authenticated by the customer's own session; see "profile email change" below. |
| customer register | **VERIFIED OPEN, not fully fixable here: see "Registration claims by phone" below.** |
| anonymisation | now also clears `verifiedEmail`/`emailVerifiedAt`. |

## Design

* `customer.verifiedEmail` + `emailVerifiedAt` (migration `20261101100000_customer_verified_email`). `verifiedEmail`
  is a separate column from `email`, so no code that edits `email` (checkout, import, merge, admin, profile, a future
  one) can move the reset destination: **only `CustomerEmailVerificationService.confirm` writes it.** Unique
  `(shopId, verifiedEmail)`: a verified address belongs to one account per shop, atomically (NULLs are distinct).
* `customerauthtoken.targetEmail`: the address a token was issued for.
* Password reset: looks up `verifiedEmail`, mails `verifiedEmail`, stamps `targetEmail`. `resetPassword` honours a link
  only while `targetEmail` still equals the account's `verifiedEmail`, and the final UPDATE re-checks that and
  `passwordHash IS NOT NULL` inside the transaction. Links minted before the migration have no `targetEmail`, so they die
  at deploy (no data UPDATE needed). A link also dies when the verified address changes.
* Verification: token 256-bit, SHA-256 at rest, 24h, single use (CAS in the same transaction as the write),
  newest link only, one a minute per address and five an hour per account, counted from the table. Public confirm
  endpoint `POST /public/:slug/auth/verify-email` (5/min/IP, CSRF-exempt like the other token-bearing pre-session
  POST because it needs the unguessable token); authed resend `POST /public/:slug/account/email/verification`.
  Every refusal on the confirm endpoint is the same 400; resend and forgot are always `201 {success: true}`.
  The storefront link opens a page that verifies only on a button press, so a mail scanner cannot consume it.
* Registration sends the link; a claimed guest row has `verifiedEmail` cleared (a claim never inherits trust).
* Profile email change: if the account has a verified address, the **current password** is required (login lockout
  counters shared), `verifiedEmail` stays on the old address until the new one is verified, the old address gets a notice,
  the new one a link. Without a verified address it is free (nothing to protect), still unproven.
* Login: only registered rows match, deterministic order (phone, then proven email). A guest row that carries a stranger's
  email can no longer shadow the real account, a DoS that the old unfiltered `rows[0]` allowed.
* Forgot-password: one link a minute per account (mail flooding), identical answers for unknown/unverified/verified
  (the dev-only `devResetLink` echo, absent in production, aside; timing is not equalised, as before).

## Legacy data: the decision and its trade-off

Existing registered accounts have `email` of unknown provenance (it may already have been overwritten). Nothing records
where it came from, so **`verifiedEmail` stays NULL for every existing row; there is no backfill.** Consequences:

* They keep logging in with their password (by phone or by the email on file). No lockout from the account.
* They can NOT reset a forgotten password until they have logged in once and verified: the account page shows
  "This email is not verified" with a "Send verification link" button. Verifying the address on file proves control
  of that address; if the address on file is wrong (an old overwrite) the owner edits it (no password needed while
  nothing is verified) and verifies the new one.
* Trade-off accepted (safest default): a legacy customer who has forgotten their password and never verified is stuck
  and has to contact the merchant. There is no phone/SMS channel to fall back on and no admin "reset customer password"
  action. **Owner question 1:** do we want a merchant-initiated recovery (an admin action that mails a verification
  link to an address the merchant has confirmed with the customer), or a phone OTP channel (WhatsApp/SMS)?
* A purely transient effect of the deploy: reset links already mailed are dead (30 minute lifetime anyway).
* Weakness remaining for a legacy account whose email was ALREADY overwritten by an attacker: the attacker's address
  is still the one on file, so if the real owner clicks "send verification link" without noticing the wrong address,
  the link goes to the attacker. The page shows the address next to the button; a stricter variant (ask the owner to
  retype the address before the first verification) is possible, **Owner question 2.**

## Registration claims by phone (VERIFIED, NOT closed, owner decision)

`CustomerAuthService.register` claims an existing guest row (same `[shopId, phone]`, no password) without any proof the
registrant owns that phone. Anyone who knows a phone number that ordered as a guest can register it and then sees that
customer's order history, addresses and any store credit on that row. The reverse (squatting a phone before the real
owner ever orders, so their later guest orders appear in the squatter's account) exists too. The takeover fix does not
change this and cannot: the only real proof is a phone OTP, and no SMS/WhatsApp channel to customers exists.
Mitigations that are in: a claim never inherits a verified email; nothing is mailed to an address typed by someone else.
**Owner question 3:** build phone OTP for registration (WhatsApp/SMS), or accept the risk (store credit granted to a
guest row is the only money exposed). Until then the credit exposure is limited to rows an admin credited.

## Behaviour changes to be aware of

* A match in `findOrCreateForOrder` is never updated, **including staff-entered orders and draft orders**: the typed
  name/email live on the order row, the CRM record changes through `PATCH /customers/:id`. The old test "updates the saved
  name when a later order uses the same phone" was rewritten to say so. **Owner question 4:** acceptable for phone orders?
* The storefront's forgot-password copy now says a verified address is required.

## Production steps

* Migrate (`npm run db:migrate`, additive, one ALTER on `customer` and one on `customerauthtoken`; the unique index is
  on an all-NULL column so it builds instantly), deploy backend then storefront. No env var.
* Deploy order: migrate, backend, storefront (the new page and the `currentPassword` field are additive; an old storefront
  on the new backend works, except a verified-account email change would 403 without the password field).
* Nothing is backfilled and no credential is created.

## Known / not done

* Timing of forgot-password differs between verified and other addresses (as before).
* The raw verification/reset token sits in the `send_email` job payload (not the idempotency key any more), same as every
  other emailed link; the job table is not pruned.
* `PATCH /customers/:id` (admin) can still edit phone raw (S4 known item 6), untouched.
