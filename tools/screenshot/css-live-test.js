const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });
  await page.goto(`http://localhost:3002/${process.argv[2]}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 600));
  const result = await page.evaluate(() => {
    const before = getComputedStyle(document.querySelector("h1")).color;
    document.documentElement.style.setProperty("--color-product-name", "rgb(255, 0, 0)");
    const after = getComputedStyle(document.querySelector("h1")).color;
    return { before, after, currentVarValue: getComputedStyle(document.documentElement).getPropertyValue("--color-product-name") };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
