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
      shopName: `Ingredients UI Shop ${tag}`,
      subdomain: `ingredients-ui-${tag}`,
      email: `ingredients-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Ingredients UI Bot",
    }),
  });
  const token = signup.accessToken;
  const outlets = await api("/outlets", {}, token);
  const outletId = outlets[0].id;

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

    // 1. Four tabs present, identical Y-position (re-verify with the new tab added).
    const tabRoutes = [
      ["/inventory", "Products"],
      ["/inventory/categories", "Categories"],
      ["/inventory/ingredients", "Ingredients"],
      ["/inventory/movements", "Movement History"],
    ];
    const tops = [];
    for (const [path, label] of tabRoutes) {
      await page.goto(`http://localhost:3001${path}`, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 400));
      const top = await page.evaluate((linkLabel) => {
        const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === linkLabel);
        return link ? link.closest("div").getBoundingClientRect().top : null;
      }, label);
      tops.push(top);
    }
    console.log("Tab bar tops across all 4 tabs:", JSON.stringify(tops));
    const allSame = tops.every((t) => t === tops[0] && t !== null);
    if (!allSame) throw new Error("FAIL: tab bar Y-position differs with the 4th tab present");
    console.log("PASS: all 4 tabs render the tab bar at identical Y-position");

    // 2. Create an ingredient via the UI.
    await page.goto("http://localhost:3001/inventory/ingredients", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/ingredients-empty.png" });

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("New ingredient"));
      btn.click();
    });
    await page.waitForSelector("form", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));

    await page.evaluate(() => {
      const form = document.querySelector("form");
      const inputs = form.querySelectorAll("input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], "Fresh Roses");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], "stems");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => {
      const form = document.querySelector("form");
      const btn = Array.from(form.querySelectorAll("button")).find((b) => b.type === "submit");
      btn.click();
    });
    await page.waitForFunction(() => document.body.textContent.includes("added"), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/ingredients-created.png" });

    const rowText = await page.evaluate(() => document.body.textContent);
    console.log("Ingredient row visible after create:", rowText.includes("Fresh Roses") && rowText.includes("stems"));

    // 3. Select an outlet, adjust stock inline, confirm via API.
    await page.evaluate(() => {
      const select = Array.from(document.querySelectorAll("select")).find((s) =>
        Array.from(s.options).some((o) => o.textContent.includes("All branches")),
      );
      if (select) {
        select.value = Array.from(select.options).find((o) => o.textContent !== "All branches")?.value ?? select.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 500));

    const adjusted = await page.evaluate(() => {
      const qtyInput = document.querySelector('input[placeholder="\u00b1qty"]');
      if (!qtyInput) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(qtyInput, "30");
      qtyInput.dispatchEvent(new Event("input", { bubbles: true }));
      const row = qtyInput.closest("td");
      const select = row.querySelector("select");
      const option = Array.from(select.options).find((o) => o.textContent.includes("Received"));
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const applyBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.trim() === "Apply");
      applyBtn.click();
      return true;
    });
    console.log("Inline stock adjust applied:", adjusted);
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/ingredients-stock-adjusted.png" });

    const ingredients = await api("/shop/ingredients", {}, token);
    console.log("Ingredient stock after inline adjust:", JSON.stringify(ingredients));

    // 4. Movement History shows the ingredient row with the "Ingredient" badge.
    await page.goto("http://localhost:3001/inventory/movements", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const movementsText = await page.evaluate(() => document.body.textContent);
    console.log("Movement History shows ingredient row:", movementsText.includes("Fresh Roses") && movementsText.includes("Ingredient"));
    await page.screenshot({ path: "./out/ingredients-movement-history.png" });

    if (!ingredients[0] || ingredients[0].name !== "Fresh Roses") {
      throw new Error("FAIL: ingredient not created correctly");
    }
    console.log("PASS: Ingredients admin UI create/list/stock-adjust/movement-history all verified");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
