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
  const rules = await page.evaluate(() => {
    const found = [];
    for (const sheet of document.styleSheets) {
      let cssRules;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of cssRules) {
        if (rule.selectorText && (rule.selectorText.includes("text-product-name") || rule.selectorText.includes("text-accent") || rule.selectorText.includes("text-price-main"))) {
          found.push(rule.cssText);
        }
      }
    }
    return found;
  });
  console.log(rules.join("\n"));
  await browser.close();
})();
