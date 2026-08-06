import { test, expect } from '@playwright/test';
import { ADMIN_URL, API_URL } from '../urls';
import { readSeedState } from '../state';

test('password reset end to end', async ({ page, request }) => {
  const seed = readSeedState();
  const newPassword = 'NewPassword456!';

  await page.goto(`${ADMIN_URL}/forgot-password`);
  await page.getByLabel('Email').fill(seed.adminEmail);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    page.getByText('If an account exists for that email, a reset link is on its way.'),
  ).toBeVisible();

  // The UI deliberately never reveals a reset token for a real inbox to
  // read — same dev-link mechanism the backend's own e2e suite uses
  // (backend/test/helpers/verify-signup-email.ts) instead of real email.
  const forgotRes = await request.post(`${API_URL}/auth/forgot-password`, {
    data: { email: seed.adminEmail },
  });
  const { devResetLink } = (await forgotRes.json()) as { devResetLink: string };
  expect(devResetLink).toBeTruthy();

  const resetPath = devResetLink.replace(/^https?:\/\/[^/]+/, '');
  await page.goto(`${ADMIN_URL}${resetPath}`);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('Password updated. Redirecting to sign in…')).toBeVisible();

  // The page auto-redirects on a fixed setTimeout — wait for the actual URL
  // change rather than racing that timer with a sleep.
  await page.waitForURL(`${ADMIN_URL}/login`, { timeout: 10_000 });

  // Close the loop: prove the new password actually works, not just that
  // the reset form said it did.
  await page.getByLabel('Email').fill(seed.adminEmail);
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${ADMIN_URL}/`, { timeout: 10_000 });
});
