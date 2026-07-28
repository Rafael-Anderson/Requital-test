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
      shopName: `Returns UI Shop ${tag}`,
      subdomain: `returns-ui-${tag}`,
      email: `returns-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Returns UI Bot",
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
        name: "Return Test Vase",
        price: 50,
        thumbnail: "https://example.com/x.jpg",
        sku: `RETUI-${tag}`,
        status: "Available",
        categoryIds: [category.id],
        trackInventory: true,
      }),
    },
    token,
  );
  await api("/products/stock/adjust", { method: "POST", body: JSON.stringify({ productId: product.id, outletId, delta: 10, reason: "received" }) }, token);

  const order = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Return Customer",
        customerPhone: "0501234567",
        customerAddress: "1 Test St",
        emirate: "Dubai",
        orderType: "delivery",
        outletId,
        items: [{ productId: product.id, quantity: 3 }],
      }),
    },
    token,
  );
  for (const status of ["confirmed", "preparing", "out_for_delivery", "delivered"]) {
    await api(`/orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, token);
  }

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1200 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    await page.goto(`http://localhost:3001/orders/${order.id}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));

    const sectionPresent = await page.evaluate(() => document.body.textContent.includes("Returns / refunds"));
    console.log("Returns section present on order detail page:", sectionPresent);

    const processClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Process return");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("'Process return' clicked:", processClicked);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/returns-form-open.png" });

    // Check the line item, set quantity to 2.
    const checkResult = await page.evaluate(() => {
      const checkbox = document.querySelector('input[type="checkbox"]');
      if (!checkbox) return "no checkbox found";
      checkbox.click();
      return "checked";
    });
    console.log("Line item checkbox toggled:", checkResult);
    await new Promise((r) => setTimeout(r, 200));

    const qtyResult = await page.evaluate(() => {
      const qtyInput = document.querySelector('input[type="number"]');
      if (!qtyInput) return "no qty input found";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(qtyInput, "2");
      qtyInput.dispatchEvent(new Event("input", { bubbles: true }));
      return "set to 2";
    });
    console.log("Quantity set:", qtyResult);
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: "./out/returns-form-filled.png" });

    const confirmClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Confirm return");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("'Confirm return' clicked:", confirmClicked);
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: "./out/returns-after-confirm.png" });

    const historyText = await page.evaluate(() => document.body.textContent);
    console.log("Return history shows refund amount (100.00 AED):", historyText.includes("100.00 AED") || historyText.includes("100 AED"));
    console.log("Return history shows restocked:", historyText.includes("restocked"));

    // Direct API verification.
    const returns = await api(`/orders/${order.id}/returns`, {}, token);
    console.log("Returns recorded via API:", JSON.stringify(returns.map((r) => ({ refundAmount: r.refundAmount, refundMethod: r.refundMethod, restocked: r.restocked }))));

    const productDetail = await api(`/products/${product.id}?outletId=${outletId}`, {}, token);
    console.log("Stock after restock (expect 9 = 10 - 3 confirmed + 2 returned):", productDetail.stockQuantity);

    const orderAfter = await api(`/orders/${order.id}`, {}, token);
    console.log("Order paymentStatus after partial refund (expect unpaid, not full):", orderAfter.paymentStatus);

    const allGood =
      sectionPresent &&
      processClicked &&
      checkResult === "checked" &&
      qtyResult === "set to 2" &&
      confirmClicked &&
      returns.length === 1 &&
      Number(returns[0].refundAmount) === 100 &&
      returns[0].restocked === true &&
      productDetail.stockQuantity === 9;
    console.log(allGood ? "PASS: Returns admin UI end-to-end verified against live server" : "FAIL: one or more checks failed");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
