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
      (a, r) => {
        localStorage.setItem("requital_admin_access_token", a);
        localStorage.setItem("requital_admin_refresh_token", r);
      },
      auth.accessToken,
      auth.refreshToken,
    );
    await page.goto("http://localhost:3001/orders/2530", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/order-notes-full.png", fullPage: true });
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
