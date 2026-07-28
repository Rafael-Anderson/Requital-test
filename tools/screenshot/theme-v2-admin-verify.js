const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = "bloom-design-1785085070809";
const ADMIN_EMAIL = `${SHOP_SLUG}@test.com`;
const ADMIN_PASSWORD = "Passw0rd!";
const ADMIN_BASE = "http://localhost:3001";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    fs.mkdirSync("./out", { recursive: true });
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
    });
    await page.setViewport({ width: 1440, height: 1400 });

    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle0" });
    await page.type('input[type="email"]', ADMIN_EMAIL);
    await page.type('input[type="password"]', ADMIN_PASSWORD);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle0" }),
    ]);
    console.log("Logged in, at:", page.url());

    await page.goto(`${ADMIN_BASE}/theme/edit/advanced`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/v2-admin-advanced.png", fullPage: true });
    console.log("Saved advanced tab screenshot");

    await page.goto(`${ADMIN_BASE}/theme/edit/appearance-color`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/v2-admin-appearance-color.png", fullPage: true });
    console.log("Saved appearance-color tab screenshot");

    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
