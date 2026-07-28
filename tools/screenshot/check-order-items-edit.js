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
      shopName: `Item Edit Shop ${tag}`,
      subdomain: `item-edit-${tag}`,
      email: `item-edit-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Item Edit Bot",
    }),
  });
  const token = signup.accessToken;
  console.log("Signed up shop", signup.user.shopId);

  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;
  console.log("Using outlet", outletId);

  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);

  const productA = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Edit Test Rose Bouquet",
        price: 50,
        thumbnail: "https://example.com/a.jpg",
        sku: `SKU-A-${tag}`,
        categoryIds: [category.id],
        trackInventory: false,
      }),
    },
    token,
  );
  const productB = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Edit Test Chocolate Box",
        price: 30,
        thumbnail: "https://example.com/b.jpg",
        sku: `SKU-B-${tag}`,
        categoryIds: [category.id],
        trackInventory: false,
      }),
    },
    token,
  );
  console.log("Created products", productA.id, productB.id);

  const order = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Item Edit Customer",
        customerPhone: "0500000000",
        customerAddress: "123 Test St",
        emirate: "Dubai",
        outletId,
        items: [{ productId: productA.id, quantity: 2 }],
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
    page.on("console", (m) => console.log("[browser]", m.text()));
    await page.evaluateOnNewDocument(
      (a, r) => {
        localStorage.setItem("requital_admin_access_token", a);
        localStorage.setItem("requital_admin_refresh_token", r);
      },
      signup.accessToken,
      signup.refreshToken,
    );
    fs.mkdirSync("./out", { recursive: true });

    await page.goto(`http://localhost:3001/orders/${order.id}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/order-items-before.png", fullPage: true });

    const editClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Edit items");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Edit items button clicked:", editClicked);
    if (!editClicked) throw new Error("Edit items button not found");

    await page.waitForSelector(".max-w-lg", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/order-items-modal-open.png" });

    // Change existing line's quantity to 5, scoped to the modal container.
    const qtyChanged = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const input = modal.querySelector('input[type="number"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    console.log("Quantity changed to 5:", qtyChanged);

    // Select second product in the add-picker and click Add.
    const productBLabel = "Edit Test Chocolate Box";
    const added = await page.evaluate((label) => {
      const modal = document.querySelector(".max-w-lg");
      const select = modal.querySelector("select");
      const option = Array.from(select.options).find((o) => o.textContent.trim() === label);
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));

      const addQtyInput = modal.querySelectorAll('input[type="number"]')[1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(addQtyInput, "3");
      addQtyInput.dispatchEvent(new Event("input", { bubbles: true }));

      const addBtn = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim().includes("Add"));
      if (!addBtn) return false;
      addBtn.click();
      return true;
    }, productBLabel);
    console.log("Second product added:", added);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/order-items-modal-edited.png" });

    const saveClicked = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const btn = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Save changes"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Save changes clicked:", saveClicked);

    await page.waitForFunction(() => !document.querySelector(".max-w-lg"), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/order-items-after.png", fullPage: true });
  } finally {
    await browser.close();
  }

  // Hit the API/DB directly — screenshot alone doesn't prove persistence.
  const fresh = await api(`/orders/${order.id}`, {}, token);
  console.log("Persisted items:", JSON.stringify(fresh.orderitem.map((i) => ({ productId: i.productId, quantity: i.quantity, name: i.productName }))));
  console.log("Persisted total:", fresh.total);

  const itemA = fresh.orderitem.find((i) => i.productId === productA.id);
  const itemB = fresh.orderitem.find((i) => i.productId === productB.id);
  const pass = itemA && itemA.quantity === 5 && itemB && itemB.quantity === 3;
  console.log(pass ? "PASS: item quantities persisted correctly" : "FAIL: persisted items do not match expected edit");
  if (!pass) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
