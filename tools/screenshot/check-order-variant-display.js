const puppeteer = require("puppeteer-core");
const fs = require("fs");

async function api(path, opts = {}, token) {
  const res = await fetch(`http://localhost:3000${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${text}`);
  return body;
}

async function main() {
  const tag = Date.now();
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Variant Display Shop ${tag}`,
      subdomain: `variant-display-${tag}`,
      email: `variant-display-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Variant Display Bot",
    }),
  });
  const token = signup.accessToken;
  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;
  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);

  let product = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Display Test Bouquet",
        price: 50,
        thumbnail: "https://example.com/x.jpg",
        sku: `VARDISP-${tag}`,
        status: "Available",
        categoryIds: [category.id],
      }),
    },
    token,
  );
  await api(`/products/${product.id}/options`, { method: "PUT", body: JSON.stringify({ options: [{ name: "Size", values: ["Large"] }] }) }, token);
  product = await api(`/products/${product.id}`, {}, token);
  const variant = product.variants[0];

  // Admin-created order with the variant line.
  const adminOrder = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Variant Display Customer",
        customerPhone: "0500000077",
        customerAddress: "1 Display Rd",
        emirate: "Dubai",
        outletId,
        items: [{ productId: product.id, variantId: variant.id, quantity: 2 }],
      }),
    },
    token,
  );

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    // 1. Standalone order detail page.
    await page.goto(`http://localhost:3001/orders/${adminOrder.id}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const pageText = await page.evaluate(() => document.body.textContent);
    console.log("Order detail page shows 'Display Test Bouquet — Large':", pageText.includes("Display Test Bouquet — Large"));
    await page.screenshot({ path: "./out/variant-display-order-page.png", clip: { x: 0, y: 0, width: 800, height: 500 } });

    // 2. Kanban OrderDetailModal.
    await page.goto("http://localhost:3001/orders", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const cardClicked = await page.evaluate((orderId) => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => s.textContent.trim() === `#${orderId}`);
      if (!el) return false;
      el.closest("div[class*='cursor-pointer']").click();
      return true;
    }, adminOrder.id);
    console.log("Kanban card clicked:", cardClicked);
    await new Promise((r) => setTimeout(r, 600));
    const modalText = await page.evaluate(() => document.body.textContent);
    console.log("OrderDetailModal shows 'Display Test Bouquet — Large':", modalText.includes("Display Test Bouquet — Large"));
    await page.screenshot({ path: "./out/variant-display-order-modal.png" });

    // 3. Storefront order tracking page.
    const tracking = await page.evaluate(async (orderId, shopToken) => {
      const res = await fetch(`http://localhost:3000/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${shopToken}` },
      });
      return res.ok ? res.json() : null;
    }, adminOrder.id, token);
    const trackingToken = tracking?.trackingToken;
    console.log("Order trackingToken retrieved:", !!trackingToken);

    const storefrontPage = await browser.newPage();
    await storefrontPage.goto(
      `http://localhost:3002/variant-display-${tag}/orders/track?token=${trackingToken}`,
      { waitUntil: "networkidle0", timeout: 30000 },
    );
    await new Promise((r) => setTimeout(r, 500));
    const storefrontText = await storefrontPage.evaluate(() => document.body.textContent);
    console.log("Storefront tracking page shows product name:", storefrontText.includes("Display Test Bouquet"));
    console.log("Storefront tracking page shows variant label 'Large' separately:", storefrontText.includes("Large"));
    await storefrontPage.screenshot({ path: "./out/variant-display-storefront-tracking.png" });

    const allPass =
      pageText.includes("Display Test Bouquet — Large") &&
      modalText.includes("Display Test Bouquet — Large") &&
      storefrontText.includes("Display Test Bouquet") &&
      storefrontText.includes("Large");
    console.log(allPass ? "PASS: variant label displays correctly at every render site" : "FAIL: one or more sites missing variant label");
    if (!allPass) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
