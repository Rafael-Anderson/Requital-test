# N2: survey consent withdrawal (branch feat/review-consent-withdrawal)

No migration (publishConsent and featuredAt already exist).

## Behaviour
- `POST /public/surveys/withdraw-consent?token=` (un-slugged, `@Public()`, throttled 20/min like `submit`).
  One statement: `UPDATE surveyresponse SET publishConsent = 0, featuredAt = NULL WHERE token = ? AND respondedAt IS NOT NULL`.
  Returns `{ withdrawn: true }` only. Unknown or malformed token: 404 (same body). Missing token: 400.
  Unanswered survey: 400. Already withdrawn, declined or NULL: same `{ withdrawn: true }` (NULL becomes 0).
  mysql2 reports CHANGED rows, so a repeat call matches 0; a follow-up SELECT (after the write) only separates
  "no such token" / "not answered" from "already withdrawn".
- Re-granting is NOT supported: `submitSurvey` stays single-shot (`respondedAt IS NULL`), admin featuring 409s on consent != 1.
- `GET /public/surveys/lookup` now also returns the customer's own `publishConsent` (true / false / null).
- Thank-you email (none existed after submit): `OrderNotificationsService.notifySurveyConsentGiven`, queued from
  `submitSurvey` only when consent was ticked, notify_email on and the order has an email. Idempotency key
  `survey:<surveyId>:consent-email`. Link = `storefrontUrl(shop, '/survey?token=...')` (the survey PAGE, so a mail
  scanner prefetching the link cannot withdraw anything; withdrawal is the button's POST).
- Storefront survey page: Withdraw control after a consenting submit and on revisiting an answered survey with consent;
  after withdrawing: "Your feedback will no longer be shown on the store's website."; declined/withdrawn shows
  "not shown"; the form never reappears for an answered survey.
- Admin Reviews: consent 0 is labelled "Declined or withdrawn" (no column added; the data cannot tell the two apart).
- No cache in front of the public reviews endpoint (browser fetch, no Cache-Control, no server cache), verified by the e2e.

## Tests
backend/test/survey-consent-withdrawal.e2e-spec.ts (10), survey-withdraw-throttle.e2e-spec.ts (1);
storefront survey page.test.tsx (+6); admin reviews page.test.tsx / lib/reviews.test.ts.

Injection proofs (revert, see fail, restore): drop featuredAt clearing (3 fail, direct column assertion); drop respondedAt
condition (unanswered test fails); drop token scoping (4 fail); drop submit single-shot (re-grant + email tests fail);
drop consent gate on the email (no-mail test fails); drop @Throttle (throttle test fails); storefront consentGiven=true (3 fail).

Screenshots: docs/handoff/n2-shots/{before,after}.
