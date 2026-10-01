import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Guard for the logical-properties sweep (audit §6-C step 1). The UA stylesheet gives a
// `th` `text-align: -internal-center`, which Chrome resolves to "center unless the parent's
// computed text-align is explicitly set"; it does NOT count the keyword `start` as explicit.
// `THead` used to set the physical left-align utility (explicit), so headers inherited it. Under
// the logical `text-start` every table header silently centred in LTR. This base rule makes
// headers inherit the thead's alignment again, and must stay in `@layer base` so a TH's own
// `text-end` / `text-center` utility still overrides it.
const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("admin globals.css, table header alignment", () => {
  it("parses (a CSS syntax error here can be swallowed by the build and silently drop rules)", () => {
    expect(() => postcss.parse(CSS)).not.toThrow();
  });

  it("makes th inherit text-align, inside @layer base", () => {
    const root = postcss.parse(CSS);
    const found: string[] = [];
    root.walkAtRules("layer", (layer) => {
      if (layer.params.trim() !== "base") return;
      layer.walkRules("th", (rule) => {
        rule.walkDecls("text-align", (d) => {
          found.push(d.value);
        });
      });
    });
    expect(found).toEqual(["inherit"]);
  });
});
