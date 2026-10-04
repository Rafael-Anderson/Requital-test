import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Guard: any element that is pinned to the viewport bottom must offset itself by
// the cookie banner's published height, or it will sit under the banner (the
// banner publishes --cookie-banner-h, see CookieConsentBanner.tsx). A new fixed
// bottom element fails here until it either adds the offset or is allow-listed
// with a reason.
const ROOT = join(__dirname, "..");
const EXEMPT: Record<string, string> = {
  "components/CookieConsentBanner.tsx": "is the banner",
  "components/CartDrawer.tsx": "full-viewport modal drawer above the banner (z-50); no bottom pin",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}

describe("fixed bottom elements offset by the cookie banner", () => {
  const offenders: string[] = [];
  for (const file of [...walk(join(ROOT, "components")), ...walk(join(ROOT, "app"))]) {
    const rel = relative(ROOT, file);
    if (EXEMPT[rel]) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return;
      // a class string with `fixed` and a bottom-pin utility, but not a top/inset-0 overlay
      if (/\bfixed\b/.test(line) && /\bbottom-/.test(line) && !/--cookie-banner-h/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  it("has no fixed bottom-pinned element without the offset", () => {
    expect(offenders).toEqual([]);
  });
});

// The PDP's sticky add-to-cart bar (under sm) publishes --sticky-bar-h; the three floating corner buttons must
// stack above it, or the back-to-top / WhatsApp / custom buttons sit underneath it on a phone.
describe("floating corner buttons stack above the PDP sticky bar", () => {
  for (const file of ["components/BackToTopButton.tsx", "components/WhatsAppFloatingButton.tsx", "components/FloatingCustomButtons.tsx"]) {
    it(`${file} adds --sticky-bar-h`, () => {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("var(--sticky-bar-h,0px)");
    });
  }
});
