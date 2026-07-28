const puppeteer = require("puppeteer-core");
const fs = require("fs");

const ADMIN_BASE = "http://localhost:3001";
const ADMIN_EMAIL = "bloom-design-1785085070809@test.com";
const ADMIN_PASSWORD = "Passw0rd!";
const SUFFIX = process.argv[2] || "after";

// The page's own PageShell div is the INNERMOST .page-transition ancestor
// of a known content anchor — /theme/edit/layout.tsx (and other section
// layouts) render their own outer "page-transition" wrapper (default wide),
// so `document.querySelector('.page-transition')` alone would silently
// grab the wrong (always-wide) one. closest() from real page content is
// the only way to reliably measure the page's own PageShell variant.

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
    await page.setViewport({ width: 1440, height: 1000 });

    await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle0" });
    await page.type('input[type="email"]', ADMIN_EMAIL);
    await page.type('input[type="password"]', ADMIN_PASSWORD);
    await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation({ waitUntil: "networkidle0" })]);
    console.log("Logged in.");

    // --- Advanced tab ---
    await page.goto(`${ADMIN_BASE}/theme/edit/advanced`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Homepage layout"), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `./out/pageshell-advanced-${SUFFIX}.png`, fullPage: true });
    const advancedInfo = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      const anchor = all.find((el) => el.children.length === 0 && el.textContent?.trim() === "Homepage layout");
      const shell = anchor?.closest(".page-transition");
      // Card row check: are "Homepage layout" and "Top bar layout" cards on
      // the same visual row (side by side) or stacked (different top y)?
      const homepageCard = anchor?.closest("[class*='rounded']");
      const topBarAnchor = all.find((el) => el.children.length === 0 && el.textContent?.trim() === "Top bar layout");
      const topBarCard = topBarAnchor?.closest("[class*='rounded']");
      const hRect = homepageCard?.getBoundingClientRect();
      const tRect = topBarCard?.getBoundingClientRect();
      return {
        shellClass: shell?.className ?? null,
        shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        sideBySide: !!(hRect && tRect && Math.abs(hRect.top - tRect.top) < 10 && hRect.left !== tRect.left),
        homepageCardTop: hRect ? Math.round(hRect.top) : null,
        topBarCardTop: tRect ? Math.round(tRect.top) : null,
      };
    });
    console.log(`[Advanced/${SUFFIX}]`, advancedInfo);

    // --- Collections list ---
    await page.goto(`${ADMIN_BASE}/collections`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelector("table") !== null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `./out/pageshell-collections-${SUFFIX}.png`, fullPage: true });
    const collectionsInfo = await page.evaluate(() => {
      const table = document.querySelector("table");
      const shell = table?.closest(".page-transition");
      return {
        shellClass: shell?.className ?? null,
        shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        tableWidth: table ? Math.round(table.getBoundingClientRect().width) : null,
      };
    });
    console.log(`[Collections/${SUFFIX}]`, collectionsInfo);

    fs.writeFileSync(`./out/pageshell-measurements-${SUFFIX}.json`, JSON.stringify({ advancedInfo, collectionsInfo }, null, 2));
    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
