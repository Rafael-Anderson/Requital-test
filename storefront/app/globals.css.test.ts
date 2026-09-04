import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Guard against the B1 regression (fixed in fix/radius-tokens-out-of-theme-block):
// in Tailwind v4 the `rounded-*` / `p-*` / `gap-*` utilities compile to
// `var(--radius-*)` / `var(--spacing-*)` with NO fallback, so *defining* one of
// those namespaced properties anywhere in this file — `@theme` OR plain `:root`
// — shifts the whole utility family on every unrelated call site. B1 named its
// runtime radius-scale tokens `--radius-sm/-md/-lg`; they are now
// `--theme-round-*` (outside every TW namespace), set only by
// applyRadiusCssVars / read only by the `.theme-round-*` classes.
const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

// `@theme` / `@theme inline` blocks contain no nested braces, so a non-greedy
// body match is sufficient.
const THEME_BLOCKS = [...CSS.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].map((m) => m[1]);

describe("globals.css — Tailwind v4 namespace hygiene", () => {
  it("has at least one @theme block (sanity — the regex still matches)", () => {
    expect(THEME_BLOCKS.length).toBeGreaterThan(0);
  });

  it("no @theme block declares a scale-namespace token (--radius-* / --spacing-*)", () => {
    const offenders = THEME_BLOCKS.flatMap((body) =>
      [...body.matchAll(/(--(?:radius|spacing)-[\w-]*)\s*:/g)].map((m) => m[1]),
    );
    expect(offenders).toEqual([]);
  });

  it("does not declare `--radius-*` anywhere (the theme radius scale is `--theme-round-*`)", () => {
    const offenders = [...CSS.matchAll(/(--radius-[\w-]*)\s*:/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  // The build (turbopack) can swallow a CSS syntax error in this file and still
  // exit 0, silently dropping every hand-written class in it — a stray `*/`
  // inside a comment (e.g. writing a `--foo-*` glob followed by `/…`) did
  // exactly that during Phase B2. Parse it here so a broken edit fails loudly.
  it("parses as valid CSS (postcss)", () => {
    expect(() => postcss.parse(CSS, { from: "globals.css" })).not.toThrow();
  });
});
