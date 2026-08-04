// Regression guard for the ProductForm.tsx wizard's Step 2 (Pricing &
// Inventory) dead-space bug: PageShell variant="form" (max-w-4xl) left
// 677-1120px of unused space to the right of the Pricing/Inventory cards at
// desktop widths — fixed by switching to variant="wide" (see ProductForm.tsx's
// own comment on that line). Re-run after any change to ProductForm.tsx or
// its PageShell usage.
//
// Run: node check-wizard-step2-width.js   (admin dev server must be running
// on :3001, backend on :3000 — see auth-fresh.json for the login token this
// uses, regenerate via POST /auth/login if it's expired)

const { measureRightEdgeGaps, assertNoDeadSpace } = require("./measure");

async function gotoStep2(page) {
  await page.evaluate(() => {
    const title = document.getElementById(
      Array.from(document.querySelectorAll("label")).find((l) => l.textContent.trim() === "Title")?.htmlFor,
    );
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(title, "Width Check Product");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Next");
    btn?.click();
  });
  await page.waitForFunction(() => document.body.textContent.includes("Price (AED)"), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
}

function locate(page) {
  return page.evaluate(() => {
    function box(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    }
    // The Pricing card — its own right edge should track the page's usable
    // width at every breakpoint regardless of which specific input is
    // longest. Found by its heading text, not a structural selector (see
    // measure.js's own doc comment on why).
    const heading = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent.trim() === "Pricing");
    const card = heading?.closest("div.rounded-lg");
    return { pricingCard: box(card) };
  });
}

async function main() {
  const results = await measureRightEdgeGaps({
    url: "http://localhost:3001/inventory/new",
    authJsonPath: "./auth-fresh.json",
    setup: gotoStep2,
    locate,
  });

  console.log(JSON.stringify(results, null, 2));
  assertNoDeadSpace(results, 24); // 24px = this app's own p-6 page padding
  console.log("check-wizard-step2-width: OK — no dead space beyond the standard page padding at any breakpoint.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
