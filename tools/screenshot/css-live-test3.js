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
    const btn = document.querySelector(".bg-button");
    const before = btn ? getComputedStyle(btn).backgroundColor : "NOT FOUND";
    document.documentElement.style.setProperty("--color-button", "rgb(255, 0, 0)");
    const after = btn ? getComputedStyle(btn).backgroundColor : "NOT FOUND";
    return { buttonBefore: before, buttonAfter: after, allButtons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()) };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
