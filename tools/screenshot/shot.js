// Visual-verification helper for layout/UI tasks. Launches the machine's
// installed Chrome (via CHROME_PATH or the common Windows install path
// below — no bundled Chromium download), navigates to a URL, waits for
// render, then either screenshots it or reports element bounding boxes so
// dead-space regressions (the store-configuration bug) can be caught
// programmatically instead of by eyeballing a PNG.
//
// Usage:
//   node shot.js <url> <outPngPath> [--full]
//     Screenshot the page (viewport by default, --full for full scroll height).
//   node shot.js <url> --boxes "<CSS selector1>,<CSS selector2>,..."
//     Print each matched element's bounding box (x, y, width, height) as
//     JSON — use this to check whether a "main" column and a "sidebar"
//     column actually span comparable heights/widths, without needing to
//     look at a screenshot at all.
//
// Env:
//   CHROME_PATH   override the Chrome executable path
//   VIEWPORT      "WIDTHxHEIGHT", default "1440x900"
//   COOKIES_JSON  path to a JSON file of puppeteer-format cookies to set
//                 before navigating (for authenticated admin pages)
//   AUTH_JSON     path to a JSON file shaped like the admin app's
//                 POST /auth/login response ({accessToken, refreshToken}).
//                 Injected into localStorage under this app's own key names
//                 (requital_admin_access_token / _refresh_token) before any
//                 page script runs, so RequireAuth sees an already-logged-in
//                 session — no need to script the login form.

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const DEFAULT_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of DEFAULT_CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome not found. Set CHROME_PATH env var to the chrome.exe path.");
}

async function main() {
  const args = process.argv.slice(2);
  const url = args[0];
  if (!url) {
    console.error("Usage: node shot.js <url> <outPngPath> [--full]  OR  node shot.js <url> --boxes \"sel1,sel2\"");
    process.exit(1);
  }

  const [w, h] = (process.env.VIEWPORT || "1440x900").split("x").map(Number);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    defaultViewport: { width: w, height: h },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    if (process.env.COOKIES_JSON && fs.existsSync(process.env.COOKIES_JSON)) {
      const cookies = JSON.parse(fs.readFileSync(process.env.COOKIES_JSON, "utf8"));
      await page.setCookie(...cookies);
    }

    if (process.env.AUTH_JSON && fs.existsSync(process.env.AUTH_JSON)) {
      const auth = JSON.parse(fs.readFileSync(process.env.AUTH_JSON, "utf8"));
      await page.evaluateOnNewDocument(
        (accessToken, refreshToken) => {
          localStorage.setItem("requital_admin_access_token", accessToken);
          localStorage.setItem("requital_admin_refresh_token", refreshToken);
        },
        auth.accessToken,
        auth.refreshToken,
      );
    }

    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    // A little extra settle time for client-fetched data (getShop() etc.)
    // to paint after the network goes idle.
    await new Promise((r) => setTimeout(r, 500));

    const boxesFlagIdx = args.indexOf("--boxes");
    if (boxesFlagIdx !== -1) {
      const selectors = (args[boxesFlagIdx + 1] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const result = {};
      for (const sel of selectors) {
        result[sel] = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, sel);
      }
      // Also report the full scrollable document height, since a page can
      // look full-width in the viewport but still trail dead space below
      // the fold — bounding boxes alone won't show that.
      const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      console.log(JSON.stringify({ url, viewport: { w, h }, docHeight, boxes: result }, null, 2));
      return;
    }

    const outPath = args[1];
    if (!outPath) throw new Error("Missing output PNG path");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const fullPage = args.includes("--full");
    await page.screenshot({ path: outPath, fullPage });
    console.log(`Saved: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
