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
    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    fs.mkdirSync("./out", { recursive: true });
    await page.screenshot({ path: "./out/inventory-list-with-duplicate-icon.png" });

    // Click the Duplicate (Copy) icon on the row.
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label^="Duplicate "]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Duplicate button found and clicked:", clicked);

    await page.waitForFunction(() => location.pathname.match(/\/inventory\/\d+\/edit/), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    console.log("Landed on:", await page.url());
    await page.screenshot({ path: "./out/duplicate-landed-on-edit.png", fullPage: true });

    const nameValue = await page.evaluate(() => {
      const input = document.querySelector('input[value]');
      return document.querySelector("h1")?.textContent;
    });
    console.log("Page heading:", nameValue);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
