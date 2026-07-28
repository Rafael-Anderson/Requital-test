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
      shopName: `Back Button Shop ${tag}`,
      subdomain: `back-button-${tag}`,
      email: `back-button-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Back Button Bot",
    }),
  });
  const token = signup.accessToken;
  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;
  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);
  const product = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Back Button Test Product",
        price: 20,
        thumbnail: "https://example.com/x.jpg",
        sku: `BACKBTN-${tag}`,
        categoryIds: [category.id],
      }),
    },
    token,
  );
  const order = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Back Button Customer",
        customerPhone: "0500000099",
        customerAddress: "1 Back Button Rd",
        emirate: "Dubai",
        outletId,
        items: [{ productId: product.id, quantity: 1 }],
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

    async function clickBack() {
      await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Back");
        link.click();
      });
      await new Promise((r) => setTimeout(r, 500));
      return page.url();
    }

    // Case 1: Movement History, reached via Products -> Categories ->
    // Movement History (polluting any history-based "back" target with
    // Categories), then Back must land on /inventory, not /inventory/categories.
    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await page.goto("http://localhost:3001/inventory/categories", { waitUntil: "networkidle0", timeout: 30000 });
    await page.goto("http://localhost:3001/inventory/movements", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    const urlAfterMovements = await clickBack();
    console.log("Movement History -> Back:", urlAfterMovements);
    await page.screenshot({ path: "./out/back-button-movements.png" });

    // Case 2: product edit page, reached via Orders (unrelated section)
    // first, then the product edit page. Back must land on /inventory, not
    // /orders (which history would give with the old router.back() logic).
    await page.goto("http://localhost:3001/orders", { waitUntil: "networkidle0", timeout: 30000 });
    await page.goto(`http://localhost:3001/inventory/${product.id}/edit`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    const urlAfterProductEdit = await clickBack();
    console.log("Product edit -> Back:", urlAfterProductEdit);
    await page.screenshot({ path: "./out/back-button-product-edit.png" });

    // Case 3: order detail page, reached via Inventory (unrelated section)
    // first. Back must land on /orders, not /inventory.
    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await page.goto(`http://localhost:3001/orders/${order.id}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    const urlAfterOrderDetail = await clickBack();
    console.log("Order detail -> Back:", urlAfterOrderDetail);
    await page.screenshot({ path: "./out/back-button-order-detail.png" });

    const results = [
      ["Movement History", urlAfterMovements, "http://localhost:3001/inventory"],
      ["Product edit", urlAfterProductEdit, "http://localhost:3001/inventory"],
      ["Order detail", urlAfterOrderDetail, "http://localhost:3001/orders"],
    ];
    let allPass = true;
    for (const [label, actual, expected] of results) {
      const pass = actual === expected;
      console.log(`${pass ? "PASS" : "FAIL"}: ${label} -> expected ${expected}, got ${actual}`);
      if (!pass) allPass = false;
    }
    if (!allPass) process.exit(1);
    console.log("PASS: all 3 back buttons land on their logical parent route regardless of prior navigation history");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
