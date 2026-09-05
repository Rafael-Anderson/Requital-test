import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NewsletterSection from "./NewsletterSection";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, shop: null, shopSlug: "test-shop", themeConfig }),
}));
vi.mock("@/lib/api", () => ({ subscribeNewsletter: vi.fn() }));

afterEach(() => {
  cleanup();
  themeConfig = null;
});

const BLOCKS: ThemeBlock[] = [{ id: "blk-form", type: "email_form", visible: true, order: 0, settings: { buttonLabel: "Subscribe" } }];

function renderNewsletter() {
  return render(<NewsletterSection sectionId="sec-newsletter" settings={{} as SectionSettings} blocks={BLOCKS} />);
}

describe("NewsletterSection submit button hoverEffect/pressEffect (§8.7 item 1)", () => {
  it("renders no extra class and no icon when buttons.primary.hoverEffect is unset (no-op)", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).not.toContain("theme-btn-");
    expect(button.querySelector("svg")).toBeNull();
  });

  it("applies theme-btn-border-fill for 'border-fill'", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "border-fill" } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).toContain("theme-btn-border-fill");
  });

  it("renders a trailing arrow icon for 'icon-nudge' only", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "icon-nudge" } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("applies theme-btn-press when pressEffect is true", () => {
    themeConfig = { globalSettings: { buttons: { primary: { pressEffect: true } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).toContain("theme-btn-press");
  });
});
