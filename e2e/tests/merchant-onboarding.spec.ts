import { test, expect, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL } from '../urls';

// A real, valid 1x1 PNG — same fixture the backend's own e2e suite uses for
// upload endpoints (backend/test/bio-page-config.e2e-spec.ts) now that
// Phase 6 sniffs real image bytes rather than trusting Content-Type.
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// The image upload on this form was observed occasionally not registering
// on the first setInputFiles call (root-caused once to the file input not
// yet being attached post-navigation — see the waitFor below — but it
// still recurred occasionally even with that fix in place, and a second
// investigation pass didn't find a further deterministic cause). Retrying
// the selection once is the standard mitigation for exactly this class of
// first-interaction upload flakiness — bounded, not a silent swallow: still
// fails loudly if a real regression breaks uploads outright.
async function uploadImage(page: Page, filename: string) {
  const fileInput = page.locator('input[type=file]');
  const removeButton = page.getByRole('button', { name: 'Remove image' });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await fileInput.waitFor({ state: 'attached', timeout: 10_000 });
    await fileInput.setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: Buffer.from(VALID_PNG_BASE64, 'base64'),
    });
    try {
      await expect(removeButton).toBeVisible({ timeout: attempt === 1 ? 8_000 : 15_000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

// The product form's Collections picker is a searchable MultiCombobox
// (closed popover) rather than an always-visible checkbox list — open it,
// tick the option, then close so the popover doesn't overlap the submit
// button on the advanced single-page form.
async function selectCollection(page: Page, name: string) {
  await page.getByRole('button', { name: 'Select collections' }).click();
  await page.getByRole('checkbox', { name, exact: true }).check();
  await page.keyboard.press('Escape');
}

test('merchant signs up, completes the wizard, creates a product in both editor modes, and publishes', async ({
  page,
  request,
}) => {
  const runId = Date.now().toString();
  const email = `pw-onboard-${runId}@test.com`;
  const password = 'Password123!';

  await page.goto(`${ADMIN_URL}/signup`);

  // Step 1 — Personal Info
  await page.getByLabel('First Name').fill('Playwright');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone Number').fill('+971501234567');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2 — Business Info
  await page.getByLabel('Business Name').fill(`Playwright Onboard Shop ${runId}`);
  await page.getByLabel('Business Type').selectOption('Retail');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 3 — Location & Setup
  await page.getByLabel('Primary Location / Address').fill('Downtown Dubai');
  await page.getByLabel('Both').check();
  await page.getByLabel('Number of Branches').selectOption('1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 4 — Review & Confirm (defaults to Simple; explicit for clarity)
  await page.getByRole('radio', { name: 'Simple' }).check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  // Not asserting on the "Welcome, {name}!" success modal here: signup
  // immediately sets the authenticated user in AuthContext, and
  // RequireAuth's guest-only-path redirect (/signup -> /) fires off that
  // same state update — in practice the redirect wins the race every time
  // this was run locally, unmounting the modal before it's ever visible to
  // the user or observable here. Landing on "/" is the real, reliably
  // observable outcome of a successful signup.
  await page.waitForURL(`${ADMIN_URL}/`, { timeout: 15_000 });

  // A collection has to pre-exist for the product form's required
  // Collections picker — creating one is a separate concern from this
  // flow (collections UI isn't one of the 4 critical paths), so it's done
  // directly against the API with the session the wizard just signed in
  // with, same as the outlet pickup-enable needed for Publish readiness.
  //
  // Session-cookie migration (security audit finding #1) — there's no
  // token in localStorage to read anymore; `page.request` (unlike the
  // standalone `request` fixture) shares the same browser context as
  // `page`, so it automatically carries the httpOnly session cookie the
  // signup flow just set. The CSRF cookie is httpOnly too now (see backend
  // CLAUDE.md's own note on why), so its value is read via Playwright's own
  // privileged `context.cookies()` API — a real browser page's JS could
  // never do this, but Playwright's automation layer isn't subject to that
  // restriction, same as how it can read cookies for assertions elsewhere.
  const csrfCookie = (await page.context().cookies()).find(
    (c) => c.name === 'req-staff-csrf',
  );
  expect(csrfCookie).toBeTruthy();
  const csrfHeaders = { 'X-CSRF-Token': csrfCookie!.value, 'Content-Type': 'application/json' };

  // Publish readiness requires a verified admin email (the banner on the
  // freshly-created home page says as much) — the wizard itself has no
  // email-verification step, so this drives the same dev-link flow the
  // backend's own e2e suite uses (backend/test/helpers/verify-signup-email.ts)
  // via resend-verification rather than a real inbox.
  const resendRes = await page.request.post(`${API_URL}/auth/resend-verification`, {
    headers: csrfHeaders,
  });
  const { devVerificationLink } = (await resendRes.json()) as { devVerificationLink?: string };
  if (devVerificationLink) {
    const token = new URL(devVerificationLink).searchParams.get('token');
    await request.post(`${API_URL}/auth/verify-email`, {
      headers: { 'Content-Type': 'application/json' },
      data: { token },
    });
  }

  const collectionRes = await page.request.post(`${API_URL}/collections`, {
    headers: csrfHeaders,
    data: { name: 'Flowers' },
  });
  const collection = (await collectionRes.json()) as { id: number };

  const outletsRes = await page.request.get(`${API_URL}/outlets`);
  const outlets = (await outletsRes.json()) as { id: number }[];
  await page.request.patch(`${API_URL}/outlets/${outlets[0].id}`, {
    headers: csrfHeaders,
    data: { pickupEnabled: true, active: true },
  });

  // --- Create a product in Simple mode (the wizard's own default) ---
  await page.goto(`${ADMIN_URL}/products/new`);
  await page.getByLabel('Title', { exact: true }).fill('Rose Bouquet');
  await uploadImage(page, 'rose.png');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Price (AED)').fill('50');
  await page.getByLabel('SKU').fill(`ONBOARD-SIMPLE-${runId}`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await selectCollection(page, 'Flowers');
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.waitForURL(`${ADMIN_URL}/products`, { timeout: 15_000 });

  // --- Switch to Advanced editor mode, then create a second product there ---
  await page.goto(`${ADMIN_URL}/settings/business/information`);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('saved', { exact: false })).toBeVisible({ timeout: 10_000 });

  await page.goto(`${ADMIN_URL}/products/new`);
  await uploadImage(page, 'tulip.png');
  // Title filled last, right before submit: on the advanced single-page
  // form (no per-step gating to wait on), filling it first was observed
  // losing its value by submit time on an occasional run — reordering
  // avoids it, and the toHaveValue below is a deliberate guard so a
  // regression here fails loudly instead of silently submitting an empty
  // title again.
  await page.getByLabel('Price (AED)').fill('40');
  await page.getByLabel('SKU').fill(`ONBOARD-ADVANCED-${runId}`);
  await selectCollection(page, 'Flowers');
  const titleField = page.getByLabel('Title', { exact: true });
  await titleField.fill('Tulip Bunch');
  await expect(titleField).toHaveValue('Tulip Bunch');
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.waitForURL(`${ADMIN_URL}/products`, { timeout: 15_000 });

  // --- Publish the shop (now unblocked: outlet pickup + >=1 product) ---
  await page.goto(`${ADMIN_URL}/settings/business/information`);
  await expect(page.getByText('Publish your store')).toBeVisible({ timeout: 10_000 });
  const publishCard = page.locator('div.justify-between', { hasText: 'Publish your store' });
  await publishCard.getByRole('switch').click();
  await expect(page.getByText('Store published')).toBeVisible({ timeout: 10_000 });
});
