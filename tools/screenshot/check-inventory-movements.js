const puppeteer = require("puppeteer-core");
const fs = require("fs");

async function main() {
  const auth = JSON.parse(fs.readFileSync("./auth.json", "utf8"));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(
      (accessToken, refreshToken) => {
        localStorage.setItem("requital_admin_access_token", accessToken);
        localStorage.setItem("requital_admin_refresh_token", refreshToken);
      },
      auth.accessToken,
      auth.refreshToken,
    );

    fs.mkdirSync("./out", { recursive: true });

    // --- Step 1: inventory list, pick a branch, fill qty+reason, Apply ---
    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    // Pick "Main Branch" from the branch switcher (BranchBar).
    const branchSelected = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const branchSelect = selects.find((s) => Array.from(s.options).some((o) => o.text.includes("Main Branch")));
      if (!branchSelect) return false;
      branchSelect.value = Array.from(branchSelect.options).find((o) => o.text.includes("Main Branch")).value;
      branchSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    console.log("Branch selected:", branchSelected);
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({ path: "./out/inv-mv-1-list-with-branch.png" });

    const filled = await page.evaluate(() => {
      const qtyInput = document.querySelector('input[placeholder="±qty"]');
      if (!qtyInput) return false;
      const row = qtyInput.closest("tr");
      const reasonSelect = row.querySelector("select");
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputSetter.call(qtyInput, "50");
      qtyInput.dispatchEvent(new Event("input", { bubbles: true }));
      reasonSelect.value = "received";
      reasonSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    console.log("Qty + reason filled:", filled);
    await page.screenshot({ path: "./out/inv-mv-2-qty-reason-filled.png" });

    await page.evaluate(() => {
      const qtyInput = document.querySelector('input[placeholder="±qty"]');
      const row = qtyInput.closest("tr");
      const applyBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.trim() === "Apply");
      applyBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/inv-mv-3-after-apply.png" });

    // --- Step 2: open Transfer modal, fill it, submit ---
    await page.evaluate(() => {
      document.querySelector('button[aria-label^="Transfer stock for"]')?.click();
    });
    await page.waitForSelector("form select", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/inv-mv-4-transfer-modal.png" });

    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("form select"));
      const fromSelect = selects[0];
      const toSelect = selects[1];
      const toOption = Array.from(toSelect.options).find((o) => o.text.includes("Downtown"));
      toSelect.value = toOption.value;
      toSelect.dispatchEvent(new Event("change", { bubbles: true }));

      const qtyInput = document.querySelector('form input[type="number"]');
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputSetter.call(qtyInput, "15");
      qtyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));

    const transferClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Transfer");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Transfer submitted:", transferClicked);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/inv-mv-5-after-transfer.png" });

    // --- Step 3: movement history page ---
    await page.goto("http://localhost:3001/inventory/movements", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/inv-mv-6-history.png", fullPage: true });

    const rowCount = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
    console.log("Movement history rows:", rowCount);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
