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
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Ing Import UI Shop ${tag}`,
      subdomain: `ing-import-ui-${tag}`,
      email: `ing-import-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Ing Import UI Bot",
    }),
  });

  const csvPath =
    "C:\\Users\\ROHAAN~1\\AppData\\Local\\Temp\\claude\\c--Requital\\926f2bef-e97a-4624-a401-0dc5f96da53d\\scratchpad\\import-test-ingredients.csv";

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1200 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("BROWSER PAGE ERROR:", err.message));
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/inventory/ingredients", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    const dropdownOpened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("New ingredient"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("New ingredient dropdown opened:", dropdownOpened);
    await new Promise((r) => setTimeout(r, 200));

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent.trim() === "Import CSV");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Import CSV clicked:", clicked);
    await new Promise((r) => setTimeout(r, 300));

    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(csvPath);
    await new Promise((r) => setTimeout(r, 200));

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Preview");
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: "./out/import-ingredients-preview.png" });

    const previewText = await page.evaluate(() => document.body.textContent);
    console.log("Preview shows create:", previewText.includes("create"));
    console.log("Preview shows reject:", previewText.includes("reject"));
    console.log("Preview shows Name required error:", previewText.includes("Name is required"));

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Confirm import"));
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    const listText = await page.evaluate(() => document.body.textContent);
    console.log("Imported ingredient visible in list:", listText.includes("UI Smoke Rose Stems"));

    const ingredients = await api("/shop/ingredients", {}, signup.accessToken);
    const created = ingredients.find((i) => i.name === "UI Smoke Rose Stems");
    console.log("API: ingredient created with unit 'stems':", created?.unit === "stems");

    const exportClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Export CSV");
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 300));
    const exportToast = await page.evaluate(() => document.body.textContent.includes("Exported"));
    console.log("Export toast shown:", exportToast);

    const allGood =
      dropdownOpened &&
      clicked &&
      previewText.includes("create") &&
      previewText.includes("reject") &&
      !!created &&
      exportClicked &&
      exportToast;
    console.log(allGood ? "PASS: Ingredients CSV import/export UI verified end-to-end" : "FAIL");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
