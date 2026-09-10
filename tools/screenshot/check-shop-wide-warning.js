// Scratch-shop pass for fix/shop-wide-scope-warning.
//
// Proves, against the real admin driven in a real browser:
//   1. Editing only OUTLET fields saves with NO dialog (unchanged path).
//   2. Changing the shop-wide Tax Rate on an outlet's Basic Info opens the
//      "This changes every outlet" dialog, naming Tax Rate (%) and nothing else.
//   3. Cancel BLOCKS the save -- the rate is unchanged on the server.
//   4. Confirm SAVES it -- and the new rate shows on the OTHER outlet too,
//      which is the thing the dialog warns about.
//   5. Delivery tab: two changed shop-wide fields open the dialog naming both.
//   6. Re-saving with nothing changed does not re-prompt (baseline resets).
//
// Usage: node tools/screenshot/check-shop-wide-warning.js <email> <password> <outletA> <outletB>
const puppeteer = require("puppeteer-core");

const API = "http://localhost:3000";
const ADMIN = "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DIALOG_TITLE = "This changes every outlet";

const [email, password, outletA, outletB] = process.argv.slice(2);
const RESULTS = [];
function check(name, pass, detail) {
  RESULTS.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PHASE = { now: "boot" };

async function shopState(page) {
  return page.evaluate(async (api) => {
    const r = await fetch(api + "/shop", { credentials: "include" });
    const b = await r.json();
    return {
      taxRate: b.taxRate,
      prep: b.deliveryPreparationTimeMinutes,
      cutoff: b.sameDayCutoffTime,
    };
  }, API);
}
async function dialogOpen(page) {
  return page.evaluate((t) => document.body.innerText.includes(t), DIALOG_TITLE);
}
async function dialogLines(page) {
  return page.evaluate(() => [...document.querySelectorAll("li")].map((n) => n.textContent.trim()));
}
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
async function clickSave(page, which) {
  await page.evaluate((w) => {
    const b = [...document.querySelectorAll("button")].filter((n) => n.textContent.trim() === "Save changes");
    (w === "first" ? b[0] : b[b.length - 1]).click();
  }, which);
  await wait(1000);
}
async function setByLabel(page, label, value) {
  const ok = await page.evaluate(
    (l, v) => {
      const lab = [...document.querySelectorAll("label")].find((n) => n.textContent.trim().startsWith(l));
      const input = lab && (lab.control || lab.parentElement.querySelector("input"));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    label,
    value,
  );
  if (!ok) throw new Error("input not found for label: " + label);
  await wait(300);
}
async function readByLabel(page, label) {
  return page.evaluate((l) => {
    const lab = [...document.querySelectorAll("label")].find((n) => n.textContent.trim().startsWith(l));
    const input = lab && (lab.control || lab.parentElement.querySelector("input"));
    return input ? input.value : null;
  }, label);
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  const errors = [];
  const failedRequests = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(r.status() + " " + r.url() + "  [phase=" + PHASE.now + "]");
  });

  await page.goto(ADMIN + "/login", { waitUntil: "networkidle0" });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await clickText(page, "Sign in");
  await wait(2500);

  PHASE.now = "post-login";
  const editA = ADMIN + "/settings/outlets/" + outletA + "/edit";

  // 1 -- outlet-only save, no dialog
  await page.goto(editA, { waitUntil: "networkidle0" });
  await wait(1500);
  await setByLabel(page, "Name in Arabic", "Branch AR");
  await clickSave(page, "last");
  check("outlet-only save shows no dialog", !(await dialogOpen(page)));

  // 2 -- tax rate change opens the dialog
  await page.goto(editA, { waitUntil: "networkidle0" });
  await wait(1500);
  const before = await shopState(page);
  // derive a value that differs from what is already stored, so the script is
  // re-runnable against the same scratch shop (setting the current value is a
  // no-change and correctly shows no dialog)
  const newTax = String((Number(before.taxRate) + 1.5) % 20);
  const newPrep = String((Number(before.prep) + 5) % 90 || 20);
  const newCutoff = before.cutoff === "14:30" ? "15:45" : "14:30";
  await setByLabel(page, "Tax Rate (%)", newTax);
  await clickSave(page, "first");
  check("tax rate change opens the dialog", await dialogOpen(page));
  const lines = await dialogLines(page);
  check("dialog names Tax Rate (%)", lines.includes("Tax Rate (%)"), JSON.stringify(lines));
  check("dialog names only what changed", lines.length === 1, JSON.stringify(lines));

  // 3 -- cancel blocks the save
  await clickText(page, "Cancel");
  const afterCancel = await shopState(page);
  check(
    "Cancel blocks the save",
    afterCancel.taxRate === before.taxRate,
    "before=" + before.taxRate + " after=" + afterCancel.taxRate,
  );
  check("dialog closes on Cancel", !(await dialogOpen(page)));

  // 4 -- confirm saves, and it is genuinely shop-wide
  await setByLabel(page, "Tax Rate (%)", newTax);
  await clickSave(page, "first");
  await clickText(page, "Save for all outlets");
  await wait(1400);
  const afterConfirm = await shopState(page);
  check(
    "Confirm saves the change",
    Number(afterConfirm.taxRate) === Number(newTax),
    "taxRate=" + afterConfirm.taxRate + " expected=" + newTax,
  );

  await page.goto(ADMIN + "/settings/outlets/" + outletB + "/edit", { waitUntil: "networkidle0" });
  await wait(1800);
  const shownOnB = await readByLabel(page, "Tax Rate");
  check(
    "the change really is shop-wide (outlet B shows the new rate)",
    Number(shownOnB) === Number(newTax),
    "outletB=" + shownOnB + " expected=" + newTax,
  );

  // 5 -- delivery tab, two changed fields
  await page.goto(editA, { waitUntil: "networkidle0" });
  await wait(1500);
  // the sidebar button's text is label + sublabel ("DeliveryAvailability & zones"),
  // so match the inner label span rather than the whole button
  const switched = await page.evaluate(() => {
    const span = [...document.querySelectorAll("nav button span span")].find(
      (n) => n.textContent.trim() === "Delivery",
    );
    if (!span) return false;
    span.closest("button").click();
    return true;
  });
  if (!switched) throw new Error("could not switch to the Delivery tab");
  await wait(2500);
  await setByLabel(page, "Preparation Time (minutes)", newPrep);
  await setByLabel(page, "Cutoff time", newCutoff);
  await clickSave(page, "last");
  check("delivery tab opens the dialog", await dialogOpen(page));
  const dLines = await dialogLines(page);
  check(
    "delivery dialog names both changed settings",
    dLines.includes("Preparation Time") && dLines.includes("Same-day order cutoff"),
    JSON.stringify(dLines),
  );
  await page.screenshot({ path: require("path").join(__dirname, "out", "shop-wide-warning-delivery.png") });
  await clickText(page, "Save for all outlets");
  await wait(1600);
  const afterD = await shopState(page);
  check(
    "delivery confirm saves both",
    afterD.prep === Number(newPrep) && afterD.cutoff === newCutoff,
    JSON.stringify(afterD) + " expected prep=" + newPrep + " cutoff=" + newCutoff,
  );

  // 6 -- re-save with nothing changed
  await clickSave(page, "last");
  check("re-save with no change shows no dialog (baseline reset)", !(await dialogOpen(page)));

  const postLoginFailures = failedRequests.filter((f) => !f.includes("[phase=boot]"));
  check(
    "no failed requests after login",
    postLoginFailures.length === 0,
    postLoginFailures.slice(0, 3).join(" | "),
  );

  console.log("  all >=400 responses seen:");
  for (const f of failedRequests) console.log("    " + f);
  if (failedRequests.length === 0) console.log("    (none)");
  await browser.close();
  const failed = RESULTS.filter((r) => !r.pass).length;
  console.log("\n" + (RESULTS.length - failed) + "/" + RESULTS.length + " passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
