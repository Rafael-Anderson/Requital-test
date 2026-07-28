const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

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
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Import UI Shop ${tag}`,
      subdomain: `import-ui-${tag}`,
      email: `import-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Import UI Bot",
    }),
  });
  await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, signup.accessToken);

  const csvPath = "C:\\Users\\ROHAAN~1\\AppData\\Local\\Temp\\claude\\c--Requital\\926f2bef-e97a-4624-a401-0dc5f96da53d\\scratchpad\\import-test.csv";

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1200 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("BROWSER CONSOLE ERROR:", msg.text());
    });
    page.on("pageerror", (err) => console.log("BROWSER PAGE ERROR:", err.message));

    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    // Import CSV now lives inside the "New product" dropdown, not a
    // standalone toolbar button — open the dropdown first.
    const dropdownOpened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("New product"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("New product dropdown opened:", dropdownOpened);
    await new Promise((r) => setTimeout(r, 200));

    const importBtnPresent = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="menuitem"]')).some((b) => b.textContent.trim() === "Import CSV"),
    );
    console.log("Import CSV menu item present:", importBtnPresent);

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent.trim() === "Import CSV");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Import CSV clicked:", clicked);
    await new Promise((r) => setTimeout(r, 300));

    const fileInput = await page.$('input[type="file"]');
    console.log("File input found:", !!fileInput);
    await fileInput.uploadFile(csvPath);
    await new Promise((r) => setTimeout(r, 200));

    const previewClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Preview");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Preview clicked:", previewClicked);
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: "./out/import-preview.png" });

    const previewText = await page.evaluate(() => document.body.textContent);
    console.log("Preview shows 'create' badge:", previewText.includes("create"));
    console.log("Preview shows 'reject' badge:", previewText.includes("reject"));
    console.log("Preview shows error message:", previewText.includes("Price is not a number"));
    console.log("Preview shows row count summary:", /1 row will be imported/.test(previewText) || /row will be imported/.test(previewText));

    const confirmClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Confirm import"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Confirm import clicked:", confirmClicked);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/import-after-confirm.png" });

    const listText = await page.evaluate(() => document.body.textContent);
    console.log("Imported product now visible in list:", listText.includes("UI Smoke Test Bouquet"));
    console.log("Rejected product NOT in list:", !listText.includes("UI Smoke Test Bad Row"));

    // Direct API verification too.
    const products = await api("/products", {}, signup.accessToken);
    const good = products.find((p) => p.sku === "UI-SMOKE-1");
    const bad = products.find((p) => p.sku === "UI-SMOKE-2");
    console.log("API: good product created:", !!good);
    console.log("API: bad product NOT created:", !bad);

    // Export CSV now only shows up in the bulk action bar once a row is
    // selected — check a product's row checkbox first.
    const checkboxSelected = await page.evaluate(() => {
      const checkbox = document.querySelector('input[type="checkbox"][aria-label^="Select "]');
      if (!checkbox) return false;
      checkbox.click();
      return true;
    });
    console.log("Selected a product row checkbox:", checkboxSelected);
    await new Promise((r) => setTimeout(r, 200));

    // Export round-trip: click Export CSV, verify no crash (download itself
    // isn't easily inspectable headless, but the click must not throw).
    const exportClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Export CSV");
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 300));
    console.log("Export CSV clicked without throwing:", exportClicked);
    const exportToast = await page.evaluate(() => document.body.textContent.includes("Exported"));
    console.log("Export toast shown:", exportToast);

    const allGood =
      dropdownOpened &&
      importBtnPresent &&
      clicked &&
      !!fileInput &&
      previewClicked &&
      previewText.includes("create") &&
      previewText.includes("reject") &&
      previewText.includes("Price is not a number") &&
      confirmClicked &&
      checkboxSelected &&
      !!good &&
      !bad &&
      exportClicked &&
      exportToast;
    console.log(allGood ? "PASS: CSV import/export UI verified end-to-end against live server" : "FAIL: one or more checks failed");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
