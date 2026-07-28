const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });
  await page.goto(`http://localhost:3002/${process.argv[2]}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 600));

  const cssHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href),
  );
  console.log("Stylesheets:", cssHrefs);

  for (const href of cssHrefs) {
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return r.text();
    }, href);
    const idx = res.indexOf(".bg-button");
    if (idx !== -1) {
      console.log(`\n--- Found .bg-button in ${href} ---`);
      console.log(res.slice(Math.max(0, idx - 20), idx + 200));
    }
    const idx2 = res.indexOf("--color-button:");
    if (idx2 !== -1) {
      console.log(`\n--- Found --color-button: definition in ${href} ---`);
      console.log(res.slice(Math.max(0, idx2 - 100), idx2 + 100));
    }
  }
  await browser.close();
})();
