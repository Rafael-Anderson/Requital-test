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
      shopName: `Collections UI Shop ${tag}`,
      subdomain: `collections-ui-${tag}`,
      email: `collections-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Collections UI Bot",
    }),
  });
  const token = signup.accessToken;
  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;
  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);

  for (const [name, price] of [["Rose Bouquet", 40], ["Lily Bundle", 60]]) {
    await api(
      "/products",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          price,
          thumbnail: "https://example.com/x.jpg",
          sku: `COLLUI-${tag}-${name.replace(/\s/g, "")}`,
          status: "Available",
          categoryIds: [category.id],
        }),
      },
      token,
    );
  }
  await api(`/outlets/${outletId}`, { method: "PATCH", body: JSON.stringify({ pickupEnabled: true }) }, token);
  await api("/shop", { method: "PATCH", body: JSON.stringify({ published: true }) }, token);

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1000 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    // 1. Home tile navigates to /collections.
    await page.goto("http://localhost:3001/", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    const tileClicked = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.includes("Collections"));
      if (!link) return false;
      link.click();
      return true;
    });
    console.log("Collections home tile found and clicked:", tileClicked);
    await page.waitForFunction(() => location.pathname === "/collections", { timeout: 10000 });

    // 2. Create a MANUAL collection.
    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.includes("New collection"));
      link.click();
    });
    await page.waitForFunction(() => location.pathname === "/collections/new", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const titleInput = document.querySelector('input[id]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(titleInput, "Summer Sale");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/collections-new-form.png" });

    // Add both products to the manual list.
    const addResult = await page.evaluate(() => {
      const select = Array.from(document.querySelectorAll("select")).find((s) =>
        Array.from(s.options).some((o) => o.textContent.includes("Select a product")),
      );
      if (!select) return "no product select found";
      const results = [];
      for (const label of ["Rose Bouquet", "Lily Bundle"]) {
        const option = Array.from(select.options).find((o) => o.textContent.trim() === label);
        if (!option) {
          results.push(`${label}: option not found`);
          continue;
        }
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const addBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().includes("Add") && b.type === "button");
        addBtn.click();
        results.push(`${label}: added`);
      }
      return results.join(", ");
    });
    console.log("Add-to-collection result:", addResult);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/collections-new-with-products.png" });

    const saveClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.type === "submit");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Save clicked:", saveClicked);
    await page.waitForFunction(() => location.pathname === "/collections", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/collections-list-after-create.png" });

    const listText = await page.evaluate(() => document.body.textContent);
    console.log("List shows 'Summer Sale':", listText.includes("Summer Sale"));

    // 3. Direct API check: persisted correctly with order.
    const collections = await api("/collections", {}, token);
    const created = collections.find((c) => c.title === "Summer Sale");
    console.log("Collection persisted:", JSON.stringify({ type: created?.type, productCount: created?.productCount }));

    // 4. Storefront collection page renders both products.
    const storefrontPage = await browser.newPage();
    await storefrontPage.goto(`http://localhost:3002/collections-ui-${tag}/collections/summer-sale`, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 600));
    const storefrontText = await storefrontPage.evaluate(() => document.body.textContent);
    console.log("Storefront collection page shows title:", storefrontText.includes("Summer Sale"));
    console.log("Storefront collection page shows both products:", storefrontText.includes("Rose Bouquet") && storefrontText.includes("Lily Bundle"));
    await storefrontPage.screenshot({ path: "./out/collections-storefront.png" });

    // 5. Bio Links: COLLECTION type option available and works.
    await page.goto("http://localhost:3001/bio-links", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const bioResult = await page.evaluate(() => {
      const addBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().includes("Add link"));
      if (!addBtn) return "add button not found";
      addBtn.click();
      return "clicked";
    });
    console.log("Bio link 'Add link' clicked:", bioResult);
    await new Promise((r) => setTimeout(r, 400));
    const typeOptionsHtml = await page.evaluate(() => {
      const select = Array.from(document.querySelectorAll("form select")).find((s) =>
        Array.from(s.options).some((o) => o.value === "COLLECTION"),
      );
      return select ? Array.from(select.options).map((o) => o.value).join(",") : null;
    });
    console.log("Bio link type options include COLLECTION:", typeOptionsHtml);

    const allGood =
      tileClicked &&
      listText.includes("Summer Sale") &&
      created?.type === "MANUAL" &&
      created?.productCount === 2 &&
      storefrontText.includes("Summer Sale") &&
      storefrontText.includes("Rose Bouquet") &&
      storefrontText.includes("Lily Bundle") &&
      typeOptionsHtml?.includes("COLLECTION");
    console.log(allGood ? "PASS: Collections admin + storefront + Bio Links integration all verified" : "FAIL: one or more checks failed");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
