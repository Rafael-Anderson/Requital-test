const puppeteer = require("puppeteer-core");
const fs = require("fs");

const SHOP_SLUG = "bloom-design-1785085070809";
const ADMIN_EMAIL = `${SHOP_SLUG}@test.com`;
const ADMIN_PASSWORD = "Passw0rd!";
const API = "http://localhost:3000";
const SITE = `http://localhost:3002/${SHOP_SLUG}`;

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const DEFAULTS = {
  topBarLayout: "logo_left",
  iconStyle: "outline",
  buttonRadius: "rounded",
  buttonFill: "solid",
  pdpLayout: "gallery_left",
  cartLayout: "full_page",
  checkoutLayout: "single_page",
  homepageLayout: "classic",
};

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { accessToken } = await res.json();
  return accessToken;
}

async function patchTheme(token, patch) {
  const res = await fetch(`${API}/theme`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH /theme failed: ${res.status} ${await res.text()}`);
}

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
  const token = await login();
  console.log("Logged in as", ADMIN_EMAIL);

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

    // --- 0. Regression baseline: defaults still render identically to Phase 2 ---
    await patchTheme(token, DEFAULTS);
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "v2-baseline-homepage", vpName, vp, SITE, { wait: 500 });
    }
    await shoot(page, "v2-baseline-pdp", "desktop", VIEWPORTS.desktop, `${SITE}/products/blush-peony-rose-bouquet`, { wait: 500 });

    // Dark mode regression — confirm Phase 1/2 contrast fix + the @theme
    // inline architecture fix are both unaffected by this pass.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await shoot(page, "v2-baseline-darkmode-homepage", "desktop", VIEWPORTS.desktop, SITE, { wait: 500 });
    await shoot(page, "v2-baseline-darkmode-pdp", "desktop", VIEWPORTS.desktop, `${SITE}/products/blush-peony-rose-bouquet`, { wait: 500 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    // --- 1. Homepage layout presets ---
    await patchTheme(token, { homepageLayout: "grid_first" });
    await shoot(page, "v2-homepage-grid-first", "desktop", VIEWPORTS.desktop, SITE, { wait: 500 });
    await patchTheme(token, { homepageLayout: "classic" });

    // --- 2. Top bar layout presets ---
    await patchTheme(token, { topBarLayout: "logo_center" });
    await shoot(page, "v2-topbar-logo-center", "desktop", VIEWPORTS.desktop, SITE, { wait: 400, fullPage: false });
    await patchTheme(token, { topBarLayout: "minimal" });
    await shoot(page, "v2-topbar-minimal-closed", "desktop", VIEWPORTS.desktop, SITE, { wait: 400, fullPage: false });
    // Open the minimal top bar's hamburger menu to prove it actually works.
    const menuOpened = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Open menu"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Minimal top bar menu opened:", menuOpened);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/v2-topbar-minimal-open-desktop.png" });
    await patchTheme(token, { topBarLayout: "logo_left" });

    // --- 3. PDP layout preset ---
    await patchTheme(token, { pdpLayout: "gallery_top" });
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      await shoot(page, "v2-pdp-gallery-top", vpName, vp, `${SITE}/products/blush-peony-rose-bouquet`, { wait: 500 });
    }
    await patchTheme(token, { pdpLayout: "gallery_left" });

    // --- 4. Cart layout preset: drawer ---
    await patchTheme(token, { cartLayout: "drawer" });
    await page.setViewport(VIEWPORTS.desktop);
    await page.goto(`${SITE}/products/blush-peony-rose-bouquet`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    // Add to cart, then open the drawer via the header cart icon.
    const added = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Add to cart"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Added to cart:", added);
    await new Promise((r) => setTimeout(r, 400));
    const drawerOpened = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Open cart"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Cart drawer opened:", drawerOpened);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/v2-cart-drawer-open-desktop.png" });
    await patchTheme(token, { cartLayout: "full_page" });

    // --- 5. Checkout layout preset: step by step ---
    await patchTheme(token, { checkoutLayout: "step_by_step" });
    await page.goto(`${SITE}/checkout`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/v2-checkout-steps-1-contact-desktop.png" });
    // Fill contact fields and advance to step 2, to prove the stepper is real.
    await page.type('input[type="tel"]', "501234567");
    const nameInputs = await page.$$("input");
    if (nameInputs[0]) await nameInputs[0].type("Test Shopper");
    await new Promise((r) => setTimeout(r, 200));
    const advanced = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Continue");
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    console.log("Advanced to step 2:", advanced);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/v2-checkout-steps-2-delivery-desktop.png" });
    await patchTheme(token, { checkoutLayout: "single_page" });

    // --- 6. Icon style + button style ---
    await patchTheme(token, { iconStyle: "solid", buttonRadius: "pill", buttonFill: "outline" });
    await shoot(page, "v2-icon-solid-button-pill-outline-homepage", "desktop", VIEWPORTS.desktop, SITE, { wait: 500 });
    await shoot(page, "v2-icon-solid-button-pill-outline-pdp", "desktop", VIEWPORTS.desktop, `${SITE}/products/blush-peony-rose-bouquet`, { wait: 500 });

    // --- Reset the demo shop back to defaults so it's left in a clean state ---
    await patchTheme(token, DEFAULTS);
    console.log("\nReset theme to defaults. Done.");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
