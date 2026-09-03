// One-shot, minimal-request setup via the real authenticated admin API
// (not raw DB writes) — logs in once, enables outlet pickup+delivery, then
// publishes the shop. Mirrors exactly what a merchant would do through the
// UI, just via fetch to avoid puppeteer login flakiness eating the 5/60s
// auth throttle.
const BASE = 'http://localhost:3000';

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test-shop.com', password: 'dev-password-123' }),
  });
  console.log('login status', loginRes.status);
  const loginBody = await loginRes.json();
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    console.log('LOGIN FAILED', JSON.stringify(loginBody));
    return;
  }
  const token = loginBody.accessToken || loginBody.token;
  console.log('got token:', !!token);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const outletRes = await fetch(`${BASE}/outlets/1`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ deliveryEnabled: true, pickupEnabled: true }),
  });
  console.log('outlet patch status', outletRes.status, await outletRes.text());

  const shopRes = await fetch(`${BASE}/shop`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ published: true }),
  });
  console.log('shop publish status', shopRes.status, (await shopRes.text()).slice(0, 300));
}

main().catch((e) => console.log('ERR', e.message));
