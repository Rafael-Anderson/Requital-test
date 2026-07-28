const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1440, height: 1024 });
  await page.goto(`http://localhost:3002/${process.argv[2]}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: "./out/before-BUG-darkmode-desktop.png" });
  await browser.close();
})();
