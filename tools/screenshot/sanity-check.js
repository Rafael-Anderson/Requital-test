const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 1440, height: 1024 });
  const shopSlug = process.argv[2];
  for (const route of ["cart", "checkout", "orders/track", "products/blush-peony-rose-bouquet"]) {
    await page.goto(`http://localhost:3002/${shopSlug}/${route}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    const name = route.replace(/\//g, "-");
    await page.screenshot({ path: `./out/sanity-${name}.png` });
    console.log(`Saved sanity-${name}.png`);
  }
  await browser.close();
})();
