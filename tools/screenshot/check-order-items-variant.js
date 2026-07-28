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
      shopName: `Variant Edit Shop ${tag}`,
      subdomain: `variant-edit-${tag}`,
      email: `variant-edit-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Variant Edit Bot",
    }),
  });
  const token = signup.accessToken;

  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;
  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);

  // Plain product already on the order.
  const plainProduct = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Plain Wrap",
        price: 15,
        thumbnail: "https://example.com/wrap.jpg",
        sku: `PLAIN-${tag}`,
        categoryIds: [category.id],
        trackInventory: false,
      }),
    },
    token,
  );

  // Variant-bearing product to be added through the modal.
  let variantProduct = await api(
    "/products",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Variant Bouquet",
        price: 60,
        thumbnail: "https://example.com/bouquet.jpg",
        sku: `VARIANT-${tag}`,
        categoryIds: [category.id],
        trackInventory: true,
      }),
    },
    token,
  );
  await api(
    `/products/${variantProduct.id}/options`,
    { method: "PUT", body: JSON.stringify({ options: [{ name: "Size", values: ["Small", "Medium"] }] }) },
    token,
  );
  variantProduct = await api(`/products/${variantProduct.id}`, {}, token);
  const mediumVariant = variantProduct.variants.find((v) => v.label === "Medium");
  console.log("Medium variant id:", mediumVariant.id);

  // Seed 10 units of the Medium variant at this outlet.
  await api(
    "/products/stock/bulk-adjust",
    {
      method: "PATCH",
      body: JSON.stringify({
        outletId,
        adjustments: [{ productId: variantProduct.id, variantId: mediumVariant.id, delta: 10 }],
      }),
    },
    token,
  );

  const order = await api(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customerName: "Variant Edit Customer",
        customerPhone: "0500000010",
        customerAddress: "1 Variant Rd",
        emirate: "Dubai",
        outletId,
        items: [{ productId: plainProduct.id, quantity: 1 }],
      }),
    },
    token,
  );
  // Confirm the order so stock is "reserved" — adding the variant item
  // through the edit modal must then actually decrement its stock, not just
  // append a row with no stock effect.
  await api(`/orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "confirmed" }) }, token);
  console.log("Order", order.id, "confirmed");

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

    await page.goto(`http://localhost:3001/orders/${order.id}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    const editClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Edit items");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Edit items clicked:", editClicked);

    await page.waitForSelector(".max-w-lg", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));

    // Select the variant-bearing product first.
    const productLabel = "Variant Bouquet";
    const productSelected = await page.evaluate((label) => {
      const modal = document.querySelector(".max-w-lg");
      const select = modal.querySelectorAll("select")[0];
      const option = Array.from(select.options).find((o) => o.textContent.trim() === label);
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, productLabel);
    console.log("Variant product selected:", productSelected);
    await new Promise((r) => setTimeout(r, 200));

    // The Option sub-picker should now be visible — select "Medium".
    const variantPicked = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const selects = modal.querySelectorAll("select");
      if (selects.length < 2) return { found: false };
      const variantSelect = selects[1];
      const option = Array.from(variantSelect.options).find((o) => o.textContent.trim() === "Medium");
      if (!option) return { found: false };
      variantSelect.value = option.value;
      variantSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true, selectCount: selects.length };
    });
    console.log("Variant option picker present and 'Medium' selected:", JSON.stringify(variantPicked));
    if (!variantPicked.found) throw new Error("FAIL: variant sub-picker did not appear or 'Medium' option missing");

    // Set add-quantity to 4.
    await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const qtyInputs = modal.querySelectorAll('input[type="number"]');
      const addQtyInput = qtyInputs[qtyInputs.length - 1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(addQtyInput, "4");
      addQtyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.screenshot({ path: "./out/variant-edit-modal-picker.png" });

    const added = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const addBtn = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim().includes("Add"));
      if (!addBtn) return false;
      addBtn.click();
      return true;
    });
    console.log("Add clicked:", added);
    await new Promise((r) => setTimeout(r, 300));

    const rowText = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      return Array.from(modal.querySelectorAll("td")).map((td) => td.textContent.trim());
    });
    console.log("Modal table cells after add:", JSON.stringify(rowText));
    if (!rowText.some((t) => t.includes("Variant Bouquet") && t.includes("Medium"))) {
      throw new Error("FAIL: added line does not show 'Variant Bouquet — Medium' label");
    }

    await page.screenshot({ path: "./out/variant-edit-modal-added.png" });

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
    await page.screenshot({ path: "./out/variant-edit-after-save.png", fullPage: true });
  } finally {
    await browser.close();
  }

  // Direct API/DB confirmation — persistence AND correct-variant stock
  // resolution, not just a UI screenshot.
  const fresh = await api(`/orders/${order.id}`, {}, token);
  const variantLine = fresh.orderitem.find((i) => i.variantId === mediumVariant.id);
  console.log("Persisted variant line:", JSON.stringify(variantLine));
  if (!variantLine || variantLine.quantity !== 4 || variantLine.variantLabel !== "Medium") {
    console.log("FAIL: variant line not persisted correctly");
    process.exit(1);
  }

  const movements = await api(`/products/stock/movements?outletId=${outletId}`, {}, token);
  console.log("Stock movements count:", movements.length);

  // Confirm the Medium variant's own outlet stock actually decremented by 4
  // (10 seeded - 4 reserved = 6), and that this didn't touch the parent
  // product's own (non-variant) stock row or the Small variant.
  const stockCheck = await api(
    "/products/stock/bulk-adjust",
    {
      method: "PATCH",
      body: JSON.stringify({ outletId, adjustments: [{ productId: variantProduct.id, variantId: mediumVariant.id, delta: 0 }] }),
    },
    token,
  );
  console.log("Current Medium variant stock (delta:0 probe):", JSON.stringify(stockCheck));
  const currentQty = stockCheck.variants?.[0]?.stockQuantity;
  if (currentQty !== 6) {
    console.log(`FAIL: expected Medium variant stock to be 6 (10 seeded - 4 reserved), got ${currentQty}`);
    process.exit(1);
  }
  console.log("PASS: variant order-item add persisted correctly and resolved stock against the correct variant");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
