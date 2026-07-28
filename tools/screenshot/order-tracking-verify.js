const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = "bloom-design-1785085070809";
const ADMIN_EMAIL = `${SHOP_SLUG}@test.com`;
const ADMIN_PASSWORD = "Passw0rd!";
const API = "http://localhost:3000";
const SITE = `http://localhost:3002/${SHOP_SLUG}`;
const VIEWPORT = { width: 1000, height: 900 };

async function adminLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

async function getFirstOutletId(adminToken) {
  const res = await fetch(`${API}/outlets`, { headers: { authorization: `Bearer ${adminToken}` } });
  const outlets = await res.json();
  return outlets[0].id;
}

async function getFirstProductId(adminToken) {
  const res = await fetch(`${API}/products`, { headers: { authorization: `Bearer ${adminToken}` } });
  const json = await res.json();
  const rows = Array.isArray(json) ? json : json.data;
  return rows[0].id;
}

async function registerCustomer(phone) {
  const res = await fetch(`${API}/public/${SHOP_SLUG}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Priya Track", phone, email: `priya-track-${Date.now()}@test.com`, password: "TrackTest1!" }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function guestCheckout(outletId, productId, phone, name) {
  const res = await fetch(`${API}/public/${SHOP_SLUG}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      outletId,
      orderType: "pickup",
      paymentMethod: "cash_on_pickup",
      customerName: name,
      customerPhone: phone,
      customerAddress: "N/A — pickup",
      emirate: "Dubai",
      items: [{ productId, quantity: 1 }],
    }),
  });
  if (!res.ok) throw new Error(`checkout failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const adminToken = await adminLogin();
  const outletId = await getFirstOutletId(adminToken);
  const productId = await getFirstProductId(adminToken);
  console.log("Admin ready. outletId:", outletId, "productId:", productId);

  // Pure guest — no account anywhere for this phone.
  const guestPhone = `05${Date.now().toString().slice(-8)}`;
  const guestOrder = await guestCheckout(outletId, productId, guestPhone, "Guest Shopper");
  const guestToken = guestOrder.order.trackingToken;
  console.log("Guest order:", guestOrder.order.id, "token:", guestToken);

  // A registered customer, and a (guest-placed, same-phone) order tied to
  // that account — exercises both "guest holding a link to an
  // account-linked order" and "logged in viewing their own order."
  const acctPhone = `05${(Date.now() + 1).toString().slice(-8)}`;
  const registered = await registerCustomer(acctPhone);
  const acctOrder = await guestCheckout(outletId, productId, acctPhone, "Priya Track");
  const acctToken = acctOrder.order.trackingToken;
  console.log("Account-linked order:", acctOrder.order.id, "token:", acctToken, "customer:", registered.customer.id);

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    fs.mkdirSync("./out", { recursive: true });
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
    await page.setViewport(VIEWPORT);

    // --- State 1: guest, no account anywhere, before any lookup ---
    await page.goto(`${SITE}/orders/track`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tracking-guest-empty.png" });
    console.log("Saved: guest, empty state");

    // --- State 2: guest, order with NO linked account ---
    await page.goto(`${SITE}/orders/track?token=${guestToken}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/tracking-guest-no-account-order.png" });
    const state2Text = await page.evaluate(() => document.body.innerText);
    console.log("State 2 mentions 'no account/login' (should be false):", state2Text.includes("no account/login"));
    console.log("State 2 mentions sign-in nudge (should be false, no linked account):", state2Text.includes("Sign in to see all your orders") || state2Text.includes("linked to an account"));

    // --- State 3: guest (not logged in), order IS linked to a registered account ---
    await page.goto(`${SITE}/orders/track?token=${acctToken}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/tracking-guest-account-linked-order.png" });
    const state3Text = await page.evaluate(() => document.body.innerText);
    console.log("State 3 shows the light sign-in nudge (should be true):", state3Text.includes("linked to an account"));
    console.log("State 3 does NOT claim ownership (should be true, not logged in):", !state3Text.includes("This is one of your orders"));

    // --- State 4: logged in AS the account that owns acctOrder, viewing it via tracking ---
    await page.goto(SITE, { waitUntil: "networkidle0" });
    await page.evaluate(
      (shopSlug, authPayload) => {
        localStorage.setItem(`requital_storefront_auth:${shopSlug}`, JSON.stringify(authPayload));
      },
      SHOP_SLUG,
      { accessToken: registered.accessToken, refreshToken: registered.refreshToken, customer: registered.customer },
    );
    await page.goto(`${SITE}/orders/track?token=${acctToken}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: "./out/tracking-logged-in-own-order.png" });
    const state4Text = await page.evaluate(() => document.body.innerText);
    console.log("State 4 greets signed-in customer (should be true):", state4Text.includes("Signed in as Priya Track"));
    console.log("State 4 confirms ownership banner (should be true):", state4Text.includes("This is one of your orders"));
    console.log("State 4 offers order-history link (should be true):", state4Text.includes("order history") || state4Text.includes("View full details"));
    console.log("State 4 does NOT show the sign-in nudge (should be true, already signed in):", !state4Text.includes("Sign in to see all your orders"));
    console.log("State 4 does NOT show the old false claim (should be true):", !state4Text.includes("no account/login"));

    // --- State 5: logged in, empty state (no lookup yet) ---
    await page.goto(`${SITE}/orders/track`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tracking-logged-in-empty.png" });
    const state5Text = await page.evaluate(() => document.body.innerText);
    console.log("State 5 greets signed-in customer with no lookup yet (should be true):", state5Text.includes("Signed in as Priya Track"));

    // --- Sanity: post-checkout confirmation page copy also fixed ---
    // Re-uses the guest order's sessionStorage handoff shape directly.
    await page.goto(`${SITE}`, { waitUntil: "networkidle0" });
    await page.evaluate(
      (id, orderObj) => sessionStorage.setItem(`requital_order:${id}`, JSON.stringify(orderObj)),
      guestOrder.order.id,
      guestOrder.order,
    );
    await page.goto(`${SITE}/orders/${guestOrder.order.id}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tracking-confirmation-copy-fixed.png" });
    const confirmText = await page.evaluate(() => document.body.innerText);
    console.log("Confirmation page no longer claims 'no account/login' (should be true):", !confirmText.includes("no account/login"));

    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
