const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://localhost:3001/login", { waitUntil: "networkidle0" });
  await page.type("input[type=email]", "bloom-design-1785085070809@test.com");
  await page.type("input[type=password]", "Passw0rd!");
  await Promise.all([page.click("button[type=submit]"), page.waitForNavigation({ waitUntil: "networkidle0" })]);
  await page.goto("http://localhost:3001/theme/edit/advanced", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Homepage layout"));
  const info = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const anchor = all.find((el) => el.children.length === 0 && el.textContent?.trim() === "Homepage layout");
    const shell = anchor?.closest(".page-transition");
    return {
      anchorFound: !!anchor,
      shellClass: shell?.className ?? null,
      shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
      // how many .page-transition ancestors exist total (nested layouts?)
      allPageTransitionWidths: Array.from(document.querySelectorAll(".page-transition")).map((el) => ({
        cls: el.className,
        w: Math.round(el.getBoundingClientRect().width),
      })),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
