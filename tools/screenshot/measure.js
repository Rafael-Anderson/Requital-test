// Reusable runtime width-measurement helper. Static grep (check-form-width.js
// at the repo root) can only catch code-level antipatterns (a hardcoded
// grid-cols-N, a fixed-width input) — it can't tell whether a PageShell
// variant is too narrow for its content, because that's a fact about the
// rendered page, not a text pattern (the exact ProductForm.tsx bug this was
// built for: every input already had `w-full`, every grid was already
// responsive, and the static checker would have found nothing — the only
// way to catch "the whole capped column is too narrow" is to actually
// render it and measure). Import this from a page-specific script (see
// check-wizard-step2-width.js for the pattern with wizard-step navigation)
// rather than reinventing the viewport loop each time.
//
// Env:
//   CHROME_PATH   override the Chrome executable path
//   AUTH_JSON     path to {accessToken, refreshToken} JSON, injected into
//                 localStorage under the admin app's own key names before
//                 any page script runs (see shot.js's own doc comment).

const puppeteer = require("puppeteer-core");
const fs = require("fs");

const DEFAULT_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const STANDARD_BREAKPOINTS = [
  { w: 375, h: 800 },
  { w: 768, h: 900 },
  { w: 1024, h: 900 },
  { w: 1440, h: 900 },
];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of DEFAULT_CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome not found. Set CHROME_PATH env var to the chrome.exe path.");
}

// Runs `setup(page)` at each breakpoint in `breakpoints` (default the 4
// standard ones) after navigating to `url`, then calls `locate(page)` —
// a function you write with `page.evaluate` — to find your landmark
// element(s) and return their bounding boxes. A plain CSS selector is
// deliberately NOT the interface here: an nth-child/structural selector is
// exactly the kind of brittle guess that silently matches the wrong (or no)
// element after the next unrelated markup change — find your landmark by
// stable text content or a real class/id instead, the same way the
// ProductForm investigation did by walking label text.
//
// `locate` must return `Record<string, {left,right,width}|null>` (null for
// "not found at this breakpoint" — this is a real failure, not a skip; see
// assertNoDeadSpace). Returns one result row per breakpoint:
//   { viewport: {w,h}, gaps: { [name]: gapPx | null } }
// `gapPx` is viewport width minus the element's right edge — the same
// "dead space to the edge" number the ProductForm.tsx investigation used.
async function measureRightEdgeGaps({ url, locate, setup, breakpoints = STANDARD_BREAKPOINTS, authJsonPath }) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const auth = authJsonPath && fs.existsSync(authJsonPath) ? JSON.parse(fs.readFileSync(authJsonPath, "utf8")) : null;

  const results = [];
  try {
    for (const vp of breakpoints) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.w, height: vp.h });
      if (auth) {
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
      await new Promise((r) => setTimeout(r, 500));
      if (setup) await setup(page);

      const boxes = await locate(page);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      const gaps = {};
      for (const [name, box] of Object.entries(boxes)) {
        gaps[name] = box ? Math.round(innerWidth - box.right) : null;
      }

      results.push({ viewport: vp, gaps });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

// Convenience assertion for scripts that want a hard pass/fail rather than
// just printing numbers: throws if any measured gap exceeds `maxGapPx`
// (default 12 — the standard page padding, per the ProductForm investigation).
// A landmark that wasn't found (null) is ALSO a failure, not a skip — a
// silently-passing "not found" is exactly how a brittle check stops meaning
// anything (this bit us once already: an nth-child CSS selector matched
// nothing and the check reported a clean pass on a page it never actually
// measured).
function assertNoDeadSpace(results, maxGapPx = 12) {
  const failures = [];
  for (const { viewport, gaps } of results) {
    for (const [name, gap] of Object.entries(gaps)) {
      if (gap === null) {
        failures.push(`${viewport.w}x${viewport.h}  ${name}  NOT FOUND — locate() didn't match anything`);
      } else if (gap > maxGapPx) {
        failures.push(`${viewport.w}x${viewport.h}  ${name}  gap=${gap}px (max ${maxGapPx}px)`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Dead-space regression:\n${failures.join("\n")}`);
  }
}

module.exports = { measureRightEdgeGaps, assertNoDeadSpace, STANDARD_BREAKPOINTS, findChrome };
