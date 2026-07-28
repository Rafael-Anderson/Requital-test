const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = process.argv[2];
if (!SHOP_SLUG) {
  console.error("Usage: node audit-storefront.js <shopSlug> [output-prefix]");
  process.exit(1);
}
const PREFIX = process.argv[3] || "audit";

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function shoot(page, name, viewportName, viewport, url, opts = {}) {
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  if (opts.wait) await new Promise((r) => setTimeout(r, opts.wait));
  const path = `./out/${PREFIX}-${name}-${viewportName}.png`;
  await page.screenshot({ path, fullPage: opts.fullPage !== false });
  console.log(`Saved ${path}`);
}

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
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    const base = `http://localhost:3002/${SHOP_SLUG}`;

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "01-homepage", vpName, vp, base, { wait: 500 });
    }

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "02-product-detail", vpName, vp, `${base}/products/blush-peony-rose-bouquet`, { wait: 500 });
    }

    // Add two items to cart via the product pages (real cart state, not empty).
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(`${base}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => /add to cart/i.test(b.textContent));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.goto(`${base}/products/mini-bonsai-gift`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => /add to cart/i.test(b.textContent));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "03-cart", vpName, vp, `${base}/cart`, { wait: 500 });
    }

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "04-checkout", vpName, vp, `${base}/checkout`, { wait: 500 });
    }

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "05-order-tracking", vpName, vp, `${base}/orders/track`, { wait: 500 });
    }

    console.log("Audit screenshots complete.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
