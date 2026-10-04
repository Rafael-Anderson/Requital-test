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

describe("globals.css — interaction states (N4)", () => {
  const root = postcss.parse(CSS, { from: "globals.css" });
  const decl = (selector: string, prop: string) => {
    let found: postcss.Declaration | undefined;
    root.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(prop, (d) => {
        found = d;
      });
    });
    return found;
  };

  it("the border-fill hover label colour wins over the secondary button's inline label colour", () => {
    // An inline style beats a plain stylesheet declaration; only !important beats the inline style.
    const color = decl(".theme-btn-border-fill:hover", "color");
    expect(color?.value).toBe("var(--color-accent-foreground)");
    expect(color?.important).toBe(true);
  });

  it("draws a two-tone :focus-visible ring from the theme tokens, on links, buttons and form controls", () => {
    const rules: string[] = [];
    root.walkRules((r) => {
      if (r.selector.includes(":focus-visible") && r.nodes.some((n) => n.type === "decl" && n.prop === "outline")) rules.push(r.selector);
    });
    const joined = rules.join(" ");
    for (const target of ["a[href]", "button", "input:focus-visible", "select:focus-visible", "textarea:focus-visible"]) {
      expect(joined).toContain(target);
    }
    const outline = decl("input:focus-visible", "outline");
    expect(outline?.value).toContain("var(--theme-focus-ring");
    expect(decl("input:focus-visible", "box-shadow")?.value).toContain("var(--theme-focus-halo");
  });

  it("keeps keyboard-focused controls clear of the cookie banner and the bottom-bar nav", () => {
    const pad = decl("html", "scroll-padding-bottom");
    expect(pad?.value).toContain("--cookie-banner-h");
    expect(pad?.value).toContain("--bottom-nav-h");
  });
});
