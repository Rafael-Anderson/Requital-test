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
  const result = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Shop now");
    const before = btn ? getComputedStyle(btn).backgroundColor : null;
    document.documentElement.style.setProperty("--color-button", "rgb(255, 0, 0)");
    document.documentElement.style.setProperty("--color-accent", "rgb(255, 0, 0)");
    const after = btn ? getComputedStyle(btn).backgroundColor : null;
    // Also test the hero's inline-style tint (should already be live, uses raw style attr not a utility class).
    const hero = document.querySelector('[style*="color-mix"]');
    return {
      buttonBefore: before,
      buttonAfter: after,
      buttonClass: btn ? btn.className : null,
      heroFound: !!hero,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
