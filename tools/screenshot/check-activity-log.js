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
    fs.mkdirSync("./out", { recursive: true });
    await page.goto("http://localhost:3001/activity-log", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/activity-log-1-all.png", fullPage: true });

    // Filter to products only.
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const entitySelect = selects.find((s) => Array.from(s.options).some((o) => o.text === "All entities"));
      const opt = Array.from(entitySelect.options).find((o) => o.value === "product");
      entitySelect.value = opt.value;
      entitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/activity-log-2-filtered.png", fullPage: true });

    const rowCount = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
    console.log("Rows after filtering to product:", rowCount);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
