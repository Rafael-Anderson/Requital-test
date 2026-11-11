import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import RichTextSection from "./RichTextSection";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ previewMode: false }) }));

const blocks = [
  { id: "t1", type: "text", visible: true, order: 0, settings: { text: "<p>Dubai Fresh Flowers - Bringing Luxury to your door</p>" } },
] as unknown as ThemeBlock[];

function wrapperFor(settings: Record<string, unknown>) {
  const { container } = render(<RichTextSection sectionId="s1" settings={settings as unknown as SectionSettings} blocks={blocks} />);
  return container.firstElementChild as HTMLElement;
}

describe("RichTextSection width", () => {
  it("by default uses the SAME container as the header and product grid, not a narrow centred column", () => {
    const w = wrapperFor({});
    expect(w.className).toContain("theme-container");
    expect(w.className).toContain("theme-gutter-x");
    expect(w.className).not.toMatch(/max-w-(2xl|3xl|5xl)/);
    expect(w.className).not.toMatch(/\bmx-auto\b/);
    expect(w.firstElementChild?.className).not.toContain("text-center");
  });

  it("'medium' and 'wide' also use the container", () => {
    for (const contentWidth of ["medium", "wide"]) {
      expect(wrapperFor({ contentWidth }).className).toContain("theme-container");
    }
  });

  it("an explicit 'narrow' (a deliberate centred statement strip) stays narrow and centred", () => {
    const w = wrapperFor({ contentWidth: "narrow" });
    expect(w.className).toContain("max-w-2xl");
    expect(w.className).toContain("mx-auto");
    expect(w.className).not.toContain("theme-container");
    expect(w.firstElementChild?.className).toContain("text-center");
  });

  it("the shared container rule is the page's own width, centred, with logical margins (RTL safe)", () => {
    const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
    const m = css.match(/\.theme-container \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("margin-inline: auto");
    expect(m![1]).toContain("max-width: var(--theme-max-width, 80rem)");
    expect(m![1]).not.toMatch(/margin-(left|right)|text-align/);
  });
});
