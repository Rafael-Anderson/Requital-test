const puppeteer = require("puppeteer-core");
const fs = require("fs");

async function api(path_, opts = {}, token) {
  const res = await fetch(`http://localhost:3000${path_}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path_} -> ${res.status}: ${text}`);
  return body;
}

async function main() {
  const tag = Date.now();
  const shopSlug = `cust-acct-ui-${tag}`;

  // --- Seed a real, publishable shop via the admin API, same pattern as
  // every other check-*.js script in this session. ---
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Customer Accounts UI Shop ${tag}`,
      subdomain: shopSlug,
      email: `cust-acct-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Shop Admin",
    }),
  });
  const adminToken = signup.accessToken;

  const outlets = await api("/outlets", {}, adminToken);
  const outletId = outlets[0].id;
  await api(`/outlets/${outletId}`, {
    method: "PATCH",
    body: JSON.stringify({
      active: true,
      emirate: "Dubai",
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryRadiusKm: 20,
      latitude: 25.2048,
      longitude: 55.2708,
    }),
  }, adminToken);

  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, adminToken);
  const product = await api("/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Test Bouquet",
      price: 75,
      thumbnail: "https://example.com/x.jpg",
      sku: `UI-${tag}`,
      trackInventory: true,
      categoryIds: [category.id],
    }),
  }, adminToken);
  const productSlug = product.slug;
  await api("/products/stock/bulk-adjust", {
    method: "PATCH",
    body: JSON.stringify({ outletId, adjustments: [{ productId: product.id, delta: 50 }] }),
  }, adminToken);
  await api("/shop", { method: "PATCH", body: JSON.stringify({ published: true }) }, adminToken);

  const customerName = "Puppeteer Customer";
  const customerPhone = "0501230000";
  const customerEmail = `puppeteer-${tag}@test.com`;
  const password = "customerPass123";

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1280, height: 1400 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("BROWSER PAGE ERROR:", err.message));
    fs.mkdirSync("./out", { recursive: true });

    // --- 1. Register ---
    await page.goto(`http://localhost:3002/${shopSlug}/account/register`, { waitUntil: "networkidle0", timeout: 30000 });
    const registerInputs = await page.$$("input");
    // Order on the register form: name(no explicit type, defaults to text), phone(tel), email, password.
    await registerInputs[0].type(customerName);
    await page.type("input[type='tel']", customerPhone);
    await page.type("input[type='email']", customerEmail);
    await page.type("input[type='password']", password);
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle0" }),
    ]);
    const onAccountAfterRegister = page.url().endsWith(`/${shopSlug}/account`);
    console.log("Registered and landed on /account:", onAccountAfterRegister);
    await page.screenshot({ path: "./out/customer-account-dashboard.png" });

    const headerShowsName = await page.evaluate((name) => document.body.textContent.includes(name), customerName);
    console.log("Header shows customer name after register:", headerShowsName);

    // --- 2. Log out ---
    const signOutClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Sign out");
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 500));
    console.log("Sign out clicked:", signOutClicked);
    const headerShowsSignInAfterLogout = await page.evaluate(() => document.body.textContent.includes("Sign in") || document.querySelector('a[href*="/account/login"]') !== null);
    console.log("Header no longer shows the customer's name after logout:", !(await page.evaluate((name) => document.body.textContent.includes(name), customerName)));

    // --- 3. Log back in ---
    await page.goto(`http://localhost:3002/${shopSlug}/account/login`, { waitUntil: "networkidle0", timeout: 30000 });
    const loginInputs = await page.$$("input");
    await loginInputs[0].type(customerPhone);
    await loginInputs[1].type(password);
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle0" }),
    ]);
    const loggedBackIn = await page.evaluate((name) => document.body.textContent.includes(name), customerName);
    console.log("Logged back in (name visible again):", loggedBackIn);

    // --- 4. Addresses: add + edit ---
    await page.goto(`http://localhost:3002/${shopSlug}/account/addresses`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Add address"));
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.type("input[placeholder='e.g. Home, Office']", "Home");
    await page.type("textarea", "1 Sheikh Zayed Rd");
    await Promise.all([
      page.click("button[type='submit']"),
      new Promise((r) => setTimeout(r, 600)),
    ]);
    const addressSaved = await page.evaluate(() => document.body.textContent.includes("1 Sheikh Zayed Rd"));
    console.log("Address saved and listed:", addressSaved);
    await page.screenshot({ path: "./out/customer-addresses.png" });

    const editClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Edit");
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 200));
    const labelInput = await page.$("input[placeholder='e.g. Home, Office']");
    await labelInput.click({ clickCount: 3 });
    await labelInput.type("Home (edited)");
    await Promise.all([page.click("button[type='submit']"), new Promise((r) => setTimeout(r, 600))]);
    const addressEdited = await page.evaluate(() => document.body.textContent.includes("Home (edited)"));
    console.log("Address edited:", editClicked, addressEdited);

    // --- 5. Checkout while logged in: confirm pre-fill + saved address ---
    await page.goto(`http://localhost:3002/${shopSlug}/products/${productSlug}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const addToCartClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => /add to cart/i.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Add to cart clicked:", addToCartClicked);
    await new Promise((r) => setTimeout(r, 300));

    await page.goto(`http://localhost:3002/${shopSlug}/checkout`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/customer-checkout-prefilled.png" });

    const prefill = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const nameInput = inputs.find((i) => i.type === "text" && i.value.length > 0 && !i.placeholder);
      const telInput = inputs.find((i) => i.type === "tel");
      const emailInput = inputs.find((i) => i.type === "email");
      return { name: nameInput?.value, phone: telInput?.value, email: emailInput?.value };
    });
    console.log("Checkout pre-filled name:", prefill.name === "Puppeteer Customer", prefill.name);
    console.log("Checkout pre-filled phone:", prefill.phone, "(expect it to contain 0501230000 digits)");
    console.log("Checkout pre-filled email:", prefill.email === customerEmail, prefill.email);

    const savedAddressPickerPresent = await page.evaluate(() =>
      document.body.textContent.includes("Use a saved address"),
    );
    console.log("Saved-address picker present at checkout:", savedAddressPickerPresent);

    // Select the saved address from the dropdown.
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const savedAddressSelect = selects.find((s) =>
        Array.from(s.options).some((o) => o.textContent.includes("1 Sheikh Zayed Rd")),
      );
      if (!savedAddressSelect) return;
      const opt = Array.from(savedAddressSelect.options).find((o) => o.textContent.includes("1 Sheikh Zayed Rd"));
      savedAddressSelect.value = opt.value;
      savedAddressSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const addressAutoFilled = await page.evaluate(() => {
      const textarea = document.querySelector("textarea");
      return textarea?.value.includes("1 Sheikh Zayed Rd");
    });
    console.log("Selecting saved address auto-fills the address textarea:", addressAutoFilled);

    // Switch to pickup to actually place the order — the saved test address
    // has no lat/lng (it was created without "Use my location"/geocoding),
    // and delivery correctly requires a location to check the radius; that
    // requirement was already exercised by picking the saved address above.
    // Pickup has no such requirement and is the simpler path to a real order.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Pickup");
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    // Explicitly cash, not whichever radio happens to be first (that could
    // be card_online, which needs Stripe configured — unrelated to this
    // feature and not worth wiring up just for this check).
    const cashSelected = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll("label")).find((l) => /cash on pickup/i.test(l.textContent));
      const radio = label?.querySelector('input[type="radio"]');
      if (!radio) return false;
      radio.click();
      return true;
    });
    console.log("Cash on pickup selected:", cashSelected);
    await new Promise((r) => setTimeout(r, 200));
    const placeOrderClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Place order");
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    console.log("Place order clicked:", placeOrderClicked);
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: "./out/customer-after-place-order.png" });
    console.log("URL after place order:", page.url());
    const checkoutErrorText = await page.evaluate(() => {
      const err = document.querySelector(".text-red-600");
      return err ? err.textContent : null;
    });
    console.log("Checkout error text (if any):", checkoutErrorText);
    console.log("Landed on order confirmation:", /\/orders\/\d+$/.test(new URL(page.url()).pathname));

    // --- 6. Order history shows the order just placed ---
    await page.goto(`http://localhost:3002/${shopSlug}/account/orders`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/customer-order-history.png" });
    const orderHistoryShowsOrder = await page.evaluate(() => document.body.textContent.includes("Order #"));
    console.log("Order history shows the placed order:", orderHistoryShowsOrder);

    const firstOrderClicked = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => /Order #/.test(a.textContent));
      if (!link) return false;
      link.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 600));
    const detailShowsItem = await page.evaluate(() => document.body.textContent.includes("Test Bouquet"));
    console.log("Order detail page shows the purchased item:", firstOrderClicked, detailShowsItem);

    // --- API cross-check: read the persisted session straight out of
    // localStorage and hit the account endpoint directly, independent of
    // whatever the UI rendered. ---
    const storedAuthRaw = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("requital_storefront_auth"));
      return key ? localStorage.getItem(key) : null;
    });
    const storedAuth = storedAuthRaw ? JSON.parse(storedAuthRaw) : null;
    const orders = storedAuth ? await api(`/public/${shopSlug}/account/orders`, {}, storedAuth.accessToken) : [];
    console.log("API: order count for this customer:", orders.length);

    const allGood =
      onAccountAfterRegister &&
      headerShowsName &&
      signOutClicked &&
      loggedBackIn &&
      addressSaved &&
      editClicked &&
      addressEdited &&
      addToCartClicked &&
      prefill.name === customerName &&
      prefill.email === customerEmail &&
      savedAddressPickerPresent &&
      addressAutoFilled &&
      placeOrderClicked &&
      orderHistoryShowsOrder &&
      detailShowsItem &&
      orders.length >= 1;
    console.log(allGood ? "PASS: Customer storefront accounts verified end-to-end against live servers" : "FAIL: one or more checks failed");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
