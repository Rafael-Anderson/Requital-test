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
      shopName: `Scan UI Shop ${tag}`,
      subdomain: `scan-ui-${tag}`,
      email: `scan-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Scan UI Bot",
    }),
  });
  await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, signup.accessToken);
  const outlets = await api("/outlets", {}, signup.accessToken);
  const outletId = outlets[0].id;

  const fixturePath = "C:\\Requital\\Requital-test\\backend\\test\\fixtures\\receipt.png";

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1400 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("BROWSER PAGE ERROR:", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("BROWSER CONSOLE ERROR:", msg.text());
    });
    page.on("response", async (res) => {
      if (res.url().includes("/scan/commit") && !res.ok()) {
        console.log("COMMIT FAILED:", res.status(), await res.text().catch(() => "?"));
      }
    });
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/inventory/scan", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    const tabPresent = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a")).some((a) => a.textContent.trim() === "Scan to Stock"),
    );
    console.log("Scan to Stock tab present:", tabPresent);

    // Expand settings, add a custom exclude keyword.
    const settingsOpened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Scan settings"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Scan settings panel opened:", settingsOpened);
    await new Promise((r) => setTimeout(r, 300));

    const keywordAdded = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[placeholder="Add a keyword and press Enter"]'));
      const excludeInput = inputs[0];
      if (!excludeInput) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(excludeInput, "smoke-test-keyword");
      excludeInput.dispatchEvent(new Event("input", { bubbles: true }));
      excludeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    });
    console.log("Custom exclude keyword added:", keywordAdded);
    await new Promise((r) => setTimeout(r, 400));
    const chipVisible = await page.evaluate(() => document.body.textContent.includes("smoke-test-keyword"));
    console.log("Exclude keyword chip rendered:", chipVisible);

    // Upload the fixture receipt and scan.
    const fileInput = await page.$('input[type="file"]');
    console.log("File input found:", !!fileInput);
    await fileInput.uploadFile(fixturePath);
    await new Promise((r) => setTimeout(r, 200));

    const scanClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Scan");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Scan clicked:", scanClicked);
    await new Promise((r) => setTimeout(r, 3000));
    await page.screenshot({ path: "./out/scan-review.png", fullPage: true });

    const pageText = await page.evaluate(() => document.body.textContent);
    console.log("Review shows 'Fresh Rose Stems':", pageText.includes("Fresh Rose Stems"));
    console.log("Review does NOT show 'Subtotal':", !pageText.includes("Subtotal"));

    // Expand raw OCR text panel.
    const rawOpened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Raw OCR text"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 200));
    const rawTextShown = await page.evaluate(() => {
      const pre = document.querySelector("pre");
      return !!pre && pre.textContent.length > 0;
    });
    console.log("Raw OCR text panel opened and shows text:", rawOpened, rawTextShown);

    // Skip every row except "Fresh Rose Stems" (rows are keyed data-row-key
    // in DOM order matching the OCR lines: row-0 GARDEN SUPPLY CO, row-1
    // Fresh Rose Stems, row-2 White Lily Bunch, row-3 Ribbon Spool).
    const skippedOthers = await page.evaluate(() => {
      let count = 0;
      for (const key of ["row-0", "row-2", "row-3"]) {
        const container = document.querySelector(`[data-row-key="${key}"]`);
        const checkbox = container?.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.click();
          count += 1;
        }
      }
      return count;
    });
    console.log("Skipped 3 other rows:", skippedOthers === 3);

    // Fill the "Fresh Rose Stems" row: pick an outlet, set price+category
    // for the (default) "create new product" path, then confirm.
    const rowFilled = await page.evaluate((outletId) => {
      const container = document.querySelector('[data-row-key="row-1"]');
      if (!container) return false;
      const outletSelect = Array.from(container.querySelectorAll("select")).find((s) =>
        Array.from(s.options).some((o) => o.value === String(outletId)),
      );
      const categorySelect = Array.from(container.querySelectorAll("select")).find((s) =>
        Array.from(s.options).some((o) => o.textContent.trim() === "General"),
      );
      const priceInput = container.querySelector("input[step='0.01']");
      if (!outletSelect || !categorySelect || !priceInput) return false;

      outletSelect.value = String(outletId);
      outletSelect.dispatchEvent(new Event("change", { bubbles: true }));

      const generalOption = Array.from(categorySelect.options).find((o) => o.textContent.trim() === "General");
      categorySelect.value = generalOption.value;
      categorySelect.dispatchEvent(new Event("change", { bubbles: true }));

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(priceInput, "33");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, outletId);
    console.log("Fresh Rose Stems row filled (outlet+category+price):", rowFilled);
    await page.screenshot({ path: "./out/scan-review-filled.png", fullPage: true });

    const confirmClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.trim().startsWith("Confirm and add to stock"),
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Confirm clicked:", confirmClicked);
    await new Promise((r) => setTimeout(r, 1200));
    const successToast = await page.evaluate(() => document.body.textContent.includes("Received:"));
    console.log("Success toast shown:", successToast);

    // Direct API verification.
    const products = await api(`/products?outletId=${outletId}`, {}, signup.accessToken);
    const created = products.find((p) => p.name === "Fresh Rose Stems");
    console.log("API: 'Fresh Rose Stems' product created:", !!created);
    console.log("API: stock quantity is 2 (parsed quantity):", created?.stockQuantity === 2);

    const settingsCheck = await api("/scan/settings", {}, signup.accessToken);
    console.log("API: custom exclude keyword persisted:", settingsCheck.excludeKeywords.includes("smoke-test-keyword"));

    const allGood =
      tabPresent &&
      settingsOpened &&
      keywordAdded &&
      chipVisible &&
      !!fileInput &&
      scanClicked &&
      pageText.includes("Fresh Rose Stems") &&
      !pageText.includes("Subtotal") &&
      rawOpened &&
      rawTextShown &&
      skippedOthers === 3 &&
      rowFilled &&
      confirmClicked &&
      successToast &&
      !!created &&
      created.stockQuantity === 2 &&
      settingsCheck.excludeKeywords.includes("smoke-test-keyword");
    console.log(allGood ? "PASS: Scan to Stock UI verified end-to-end against live server" : "FAIL: one or more checks failed");
    if (!allGood) process.exit(1);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
