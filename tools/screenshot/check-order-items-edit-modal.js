const puppeteer = require("puppeteer-core");
const fs = require("fs");

const API = "http://localhost:3000";

async function api(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
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
      shopName: `Kanban Edit Shop ${tag}`,
      subdomain: `kanban-edit-${tag}`,
      email: `kanban-edit-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Kanban Edit Bot",
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
        name: "Kanban Edit Bouquet",
        price: 40,
        thumbnail: "https://example.com/a.jpg",
        sku: `SKU-K-${tag}`,
        categoryIds: [category.id],
        trackInventory: false,
      }),
    },
    token,
  );
  const order = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Kanban Edit Customer",
        customerPhone: "0500000001",
        customerAddress: "1 Board Rd",
        emirate: "Dubai",
        outletId,
        items: [{ productId: product.id, quantity: 1 }],
      }),
    },
    token,
  );
  console.log("Created order", order.id, "status:", order.status);

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(
      (a, r) => {
        localStorage.setItem("requital_admin_access_token", a);
        localStorage.setItem("requital_admin_refresh_token", r);
      },
      signup.accessToken,
      signup.refreshToken,
    );
    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/orders", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    const cardClicked = await page.evaluate((orderId) => {
      const el = Array.from(document.querySelectorAll("span")).find((s) => s.textContent.trim() === `#${orderId}`);
      if (!el) return false;
      el.closest("div[class*='cursor-pointer']").click();
      return true;
    }, order.id);
    console.log("Kanban card clicked:", cardClicked);
    if (!cardClicked) throw new Error("Order card not found on kanban board");

    await page.waitForSelector(".max-w-3xl", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/kanban-order-detail-modal.png" });

    const editClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Edit items");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Edit items clicked inside OrderDetailModal:", editClicked);
    if (!editClicked) throw new Error("Edit items button not found inside OrderDetailModal");

    await page.waitForSelector(".max-w-lg", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/kanban-nested-edit-modal-open.png" });

    // Click the nested modal's own backdrop (top-left corner, outside its
    // panel but still inside the outer OrderDetailModal). This must close
    // ONLY the item editor, not bubble up and close OrderDetailModal too —
    // the exact class of bug fixed earlier via stopPropagation.
    await page.mouse.click(20, 20);
    await new Promise((r) => setTimeout(r, 300));

    const state = await page.evaluate(() => ({
      nestedModalOpen: !!document.querySelector(".max-w-lg"),
      outerModalOpen: !!document.querySelector(".max-w-3xl"),
    }));
    console.log("After backdrop click:", JSON.stringify(state));
    await page.screenshot({ path: "./out/kanban-after-backdrop-click.png" });

    if (state.nestedModalOpen) throw new Error("FAIL: nested item-editor did not close on its own backdrop click");
    if (!state.outerModalOpen) throw new Error("FAIL: backdrop click on nested modal incorrectly closed the outer OrderDetailModal too");
    console.log("PASS: nested modal closed independently, outer OrderDetailModal stayed open");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
