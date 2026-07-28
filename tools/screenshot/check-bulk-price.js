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

    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('tbody input[type="checkbox"]'));
      boxes.forEach((b) => b.click());
    });
    await new Promise((r) => setTimeout(r, 300));

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Adjust prices");
      btn?.click();
    });
    await page.waitForSelector('input[type="number"]', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/bulk-price-1-modal-empty.png" });

    // Type 20 into the percentage field (should be the only number input in the modal).
    await page.evaluate(() => {
      const input = document.querySelector('.fixed input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/bulk-price-2-preview.png" });

    // Scoped to the modal specifically (max-w-lg is unique to it) — the
    // bulk-status bar above the table also has its own "Apply" button with
    // identical text, and a page-wide match grabs whichever is first in DOM
    // order (the bar's, not the modal's).
    const applyClicked = await page.evaluate(() => {
      const modal = document.querySelector(".max-w-lg");
      const btn = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim() === "Apply");
      btn?.click();
      return !!btn;
    });
    console.log("Apply clicked:", applyClicked);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/bulk-price-3-after-apply.png" });

    const prices = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tbody tr")).map((tr) => tr.querySelector("td:nth-child(3)")?.textContent.trim()),
    );
    console.log("Prices after bulk +20%:", prices);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
