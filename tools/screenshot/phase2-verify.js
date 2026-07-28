const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = process.argv[2];
const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function shoot(page, name, vpName, vp, url, opts = {}) {
  await page.setViewport(vp);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  if (opts.wait) await new Promise((r) => setTimeout(r, opts.wait));
  if (opts.before) await opts.before(page);
  const path = `./out/${name}-${vpName}.png`;
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
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
    });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    const base = `http://localhost:3002/${SHOP_SLUG}`;

    // --- Homepage, Phase 2 (category showcase + card excerpts) ---
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "phase2-homepage", vpName, vp, base, { wait: 600 });
    }

    // --- PDP: hero product (gallery + rich description + related products) ---
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "phase2-pdp-gallery", vpName, vp, `${base}/products/blush-peony-rose-bouquet`, { wait: 600 });
    }

    // Click the second thumbnail to prove gallery switching works.
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(`${base}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    const thumbClicked = await page.evaluate(() => {
      const thumbs = document.querySelectorAll('button[aria-label^="View image"]');
      if (thumbs.length < 2) return false;
      thumbs[1].click();
      return true;
    });
    console.log("Gallery thumbnail 2 clicked:", thumbClicked);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/phase2-pdp-gallery-switched-desktop.png" });

    // --- PDP: variant product (selectors, live price/stock update) ---
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "phase2-pdp-variants", vpName, vp, `${base}/products/seasonal-bouquet-made-to-order`, { wait: 600 });
    }

    // Select Large + Blush Pink (the deliberately low-stock combo) and confirm
    // price/stock update live.
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(`${base}/products/seasonal-bouquet-made-to-order`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    const selected = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const large = buttons.find((b) => b.textContent.trim() === "Large");
      const blush = buttons.find((b) => b.textContent.trim() === "Blush Pink");
      if (!large || !blush) return false;
      large.click();
      blush.click();
      return true;
    });
    console.log("Selected Large + Blush Pink:", selected);
    await new Promise((r) => setTimeout(r, 300));
    const stockTextAfterSelect = await page.evaluate(() => document.body.textContent.match(/Only \d+ left/)?.[0] ?? null);
    console.log("Low-stock message shown after selecting low-stock variant:", stockTextAfterSelect);
    await page.screenshot({ path: "./out/phase2-pdp-variant-selected-desktop.png" });

    // --- Mobile sticky CTA: scroll past the real button, confirm the sticky bar appears ---
    await page.setViewport(VIEWPORTS.mobile);
    await page.goto(`${base}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 400));
    const stickyVisible = await page.evaluate(() => {
      const bar = document.querySelector(".fixed.bottom-0");
      if (!bar) return false;
      const rect = bar.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > 0;
    });
    console.log("Sticky mobile CTA visible after scrolling past the real button:", stickyVisible);
    await page.screenshot({ path: "./out/phase2-pdp-sticky-cta-mobile.png" });

    // --- Dark mode: re-check homepage AND PDP now both readable ---
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(base, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/phase2-darkmode-homepage-desktop.png" });
    await page.goto(`${base}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/phase2-darkmode-pdp-desktop.png" });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    // --- Sanity: cart/checkout/tracking unaffected (structure, not full audit) ---
    for (const route of ["cart", "checkout", "orders/track"]) {
      await page.goto(`${base}/${route}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 400));
      const name = route.replace(/\//g, "-");
      await page.screenshot({ path: `./out/phase2-sanity-${name}.png` });
      console.log(`Sanity screenshot saved: ${name}`);
    }

    console.log("\nDone.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
