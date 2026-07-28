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
  await page.goto(`http://localhost:3002/${process.argv[2]}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 600));
  const diagnosis = await page.evaluate(() => {
    const root = document.documentElement;
    const h1 = document.querySelector("h1");
    const desc = document.querySelector(".text-zinc-600");
    return {
      matchMediaDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      rootInlineProductName: root.style.getPropertyValue("--color-product-name"),
      computedProductNameVar: getComputedStyle(root).getPropertyValue("--color-product-name"),
      h1ComputedColor: h1 ? getComputedStyle(h1).color : null,
      h1ClassList: h1 ? h1.className : null,
      descComputedColor: desc ? getComputedStyle(desc).color : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(JSON.stringify(diagnosis, null, 2));
  await browser.close();
})();
