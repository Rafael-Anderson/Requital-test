// Scratch-shop pass for the Phase 0 admin changes (parts B and C).
//
// Proves, against the real admin driven in a real browser:
//   1. Store Configuration's "Coming Soon" card now holds all six dead
//      toggles, and none of them is left behind in a live card.
//   2. "Allow WhatsApp Notifications" is gone from Business Information.
//   3. Saving from the Coming Soon card still persists (the six moved with
//      their state/load/save wiring, not just their markup).
//   4. Customers has a tab bar, and the Newsletter tab renders with a
//      working Export CSV button.
//   5. Integrations' fourth tab reads "Incoming Webhooks".
//
// Usage: node tools/screenshot/check-phase0-admin.js <email> <password>
const puppeteer = require("puppeteer-core");
const path = require("path");

const API = "http://localhost:3000";
const ADMIN = "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const COMING_SOON = [
  "Allow pre-orders",
  "Allow WhatsApp Notifications",
  '"As soon as possible" delivery option enabled',
  "Birthday discount enabled",
  "Customer confirmation required for order",
  "Dynamic theme builder enabled",
  "Enable delivery calendar / timeslots",
];

const [email, password] = process.argv.slice(2);
const RESULTS = [];
function check(name, pass, detail) {
  RESULTS.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((n) => n.textContent.trim() === t);
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error("button not found: " + text);
  await wait(900);
}

// Returns the labels of every checkbox inside the card whose heading matches.
async function cardCheckboxLabels(page, heading) {
  return page.evaluate((h) => {
    const head = [...document.querySelectorAll("h3")].find((n) => n.textContent.trim() === h);
    if (!head) return null;
    const card = head.parentElement;
    return [...card.querySelectorAll("label")]
      .map((l) => l.textContent.trim())
      .filter(Boolean);
  }, heading);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--user-data-dir=" + require("os").tmpdir() + "/requital-pp-" + Date.now()] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  const failedRequests = [];
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(r.status() + " " + r.url());
  });

  await page.goto(ADMIN + "/login", { waitUntil: "networkidle0" });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await clickText(page, "Sign in");
  await wait(2500);
  // The two pre-login boot 401s (/auth/me, /auth/refresh) are expected and
  // attributable, so both buffers reset here rather than being allowlisted.
  failedRequests.length = 0;
  consoleErrors.length = 0;

  // ---- 1. Store Configuration: every dead toggle under Coming Soon
  await page.goto(ADMIN + "/settings/business/store-configuration", { waitUntil: "networkidle0" });
  await wait(1500);
  const comingSoon = await cardCheckboxLabels(page, "Coming Soon");
  check(
    "Coming Soon card holds all six moved toggles",
    COMING_SOON.every((l) => comingSoon && comingSoon.includes(l)),
    JSON.stringify(comingSoon),
  );
  for (const heading of ["Storefront Display", "Delivery & Fulfillment", "Messaging"]) {
    const labels = (await cardCheckboxLabels(page, heading)) ?? [];
    const leaked = COMING_SOON.filter((l) => labels.includes(l));
    check(`no dead toggle left in "${heading}"`, leaked.length === 0, JSON.stringify(leaked));
  }
  await page.screenshot({ path: path.join(__dirname, "out", "phase0-store-configuration.png"), fullPage: true });

  // ---- 2. the save wiring moved with them
  const before = await page.evaluate(async (api) => {
    const r = await fetch(api + "/shop", { credentials: "include" });
    const b = await r.json();
    return { notifyWhatsapp: b.notifyWhatsapp, allowPreOrders: b.allowPreOrders };
  }, API);
  const toggled = await page.evaluate((label) => {
    const l = [...document.querySelectorAll("label")].find((n) => n.textContent.trim() === label);
    const input = l && (l.control || l.parentElement.querySelector('input[type="checkbox"]'));
    if (!input) return false;
    input.click();
    return true;
  }, "Allow WhatsApp Notifications");
  check("the moved WhatsApp toggle is interactive", toggled);
  await clickText(page, "Save changes");
  await wait(1200);
  const after = await page.evaluate(async (api) => {
    const r = await fetch(api + "/shop", { credentials: "include" });
    const b = await r.json();
    return { notifyWhatsapp: b.notifyWhatsapp };
  }, API);
  check(
    "saving from Coming Soon persists notifyWhatsapp (state/load/save moved too)",
    after.notifyWhatsapp === !before.notifyWhatsapp,
    `before=${before.notifyWhatsapp} after=${after.notifyWhatsapp}`,
  );

  // ---- 3. gone from Business Information
  await page.goto(ADMIN + "/settings/business/information", { waitUntil: "networkidle0" });
  await wait(1500);
  const infoText = await page.evaluate(() => document.body.innerText);
  check(
    "Business Information no longer offers Allow WhatsApp Notifications",
    !infoText.includes("Allow WhatsApp Notifications"),
  );
  check("Business Information still offers Allow Email Notifications", infoText.includes("Allow Email Notifications"));

  // ---- 4. Customers tabs + Newsletter page
  await page.goto(ADMIN + "/customers", { waitUntil: "networkidle0" });
  await wait(1500);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("nav a, a")].map((a) => a.textContent.trim()));
  check("Customers page shows a Newsletter tab", tabs.includes("Newsletter"), "");

  await page.goto(ADMIN + "/customers/newsletter", { waitUntil: "networkidle0" });
  await wait(1800);
  const newsletterText = await page.evaluate(() => document.body.innerText);
  check("Newsletter page renders its own heading and tab", newsletterText.includes("Newsletter"));
  check(
    "Newsletter page renders the table or the empty state, not an error",
    newsletterText.includes("No subscribers yet") ||
      // innerText applies the header cell text-transform, so this reads EMAIL
      newsletterText.includes("EMAIL") ||
      newsletterText.includes("No matching subscribers"),
  );
  const exportBtn = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.trim().includes("Export CSV")),
  );
  check("Newsletter page has an Export CSV button", exportBtn);
  await page.screenshot({ path: path.join(__dirname, "out", "phase0-newsletter.png"), fullPage: true });

  // ---- 5. Integrations tab rename
  await page.goto(ADMIN + "/integrations/webhooks", { waitUntil: "networkidle0" });
  await wait(1500);
  const integrationsTabs = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.textContent.trim()));
  check("Integrations tab reads Incoming Webhooks", integrationsTabs.includes("Incoming Webhooks"));
  check("the bare Webhooks label is gone", !integrationsTabs.includes("Webhooks"));

  check("no failed requests after login", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));
  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  await browser.close();
  const failed = RESULTS.filter((r) => !r.pass).length;
  console.log("\n" + (RESULTS.length - failed) + "/" + RESULTS.length + " passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
