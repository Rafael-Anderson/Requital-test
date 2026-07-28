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

    await page.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    // Confirm the palette is NOT open initially.
    const closedInitially = await page.evaluate(() => !document.body.textContent.includes("Search products, orders"));
    console.log("Closed initially:", closedInitially);

    // Press Ctrl+K (the real global keyboard shortcut, not a button click).
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyK");
    await page.keyboard.up("Control");
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/palette-1-opened.png" });

    const opened = await page.evaluate(() => !!document.querySelector('input[placeholder^="Search products"]'));
    console.log("Opened via Ctrl+K:", opened);

    // Type a query that should hit all three categories.
    await page.keyboard.type("Test", { delay: 30 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/palette-2-results.png" });

    const resultCount = await page.evaluate(() => document.querySelectorAll('.max-w-lg button[type="button"]').length);
    console.log("Result rows shown:", resultCount);

    // Arrow-down to highlight the second result, confirm highlight moved.
    await page.keyboard.press("ArrowDown");
    await new Promise((r) => setTimeout(r, 150));
    await page.screenshot({ path: "./out/palette-3-arrow-nav.png" });

    // Escape closes it.
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
    const closedAfterEscape = await page.evaluate(() => !document.querySelector('input[placeholder^="Search products"]'));
    console.log("Closed after Escape:", closedAfterEscape);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
