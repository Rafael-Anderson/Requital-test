const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = process.argv[2];
const PREFIX = process.argv[3] || "after";

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

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
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewport(vp);
      await page.goto(`http://localhost:3002/${SHOP_SLUG}`, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 600));
      const path = `./out/${PREFIX}-01-homepage-${vpName}.png`;
      await page.screenshot({ path, fullPage: true });
      console.log(`Saved ${path}`);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
