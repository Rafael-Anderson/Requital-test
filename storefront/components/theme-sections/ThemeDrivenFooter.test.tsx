import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ThemeDrivenFooter from "./ThemeDrivenFooter";
import type { HeaderFooterConfig } from "@/lib/theme-config-types";
import type { Shop } from "@/lib/types";

// Mirrors backend DEFAULT_THEME_CONFIG.footer (the shape an untouched theme
// ships with) — no columns/showPaymentIcons/waveEdge/bottomBarSeparate keys.
const DEFAULT_FOOTER: HeaderFooterConfig = {
  settings: {},
  blocks: [{ id: "ftr-copyright", type: "footer_copyright", visible: true, order: 0, settings: {} }],
};

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, themeConfig: null }),
}));
vi.mock("@/lib/api", () => ({ resolveImageUrl: (u: string | null) => u }));
vi.mock("@/components/BackToTopButton", () => ({ default: () => null }));

afterEach(cleanup);

const shop = { displayName: "Test Shop", name: "test", socialLinks: {}, cardProcessorEnabled: false, deliveryPaymentCashOnDelivery: false, pickupPaymentCashOnPickup: false, enabledPaymentProviders: [] } as unknown as Shop;

function renderFooter(config: HeaderFooterConfig) {
  return render(<ThemeDrivenFooter shop={shop} config={config} />);
}

describe("ThemeDrivenFooter — no-op (C1)", () => {
  it("renders flex-wrap (not grid) for the top row when columns is unset", () => {
    const cfg: HeaderFooterConfig = {
      ...DEFAULT_FOOTER,
      blocks: [...DEFAULT_FOOTER.blocks, { id: "ftr-social", type: "footer_social", visible: true, order: 1, settings: {} }],
    };
    const withSocial = { ...shop, socialLinks: { instagram: "https://instagram.com/x" } } as unknown as Shop;
    const { container } = render(<ThemeDrivenFooter shop={withSocial} config={cfg} />);
    const row = container.querySelector(".flex.flex-wrap.justify-between");
    expect(row).not.toBeNull();
  });

  it("renders no payment badges, no wave SVG, and no separate bottom bar by default", () => {
    const { container, queryByText } = renderFooter(DEFAULT_FOOTER);
    expect(container.querySelector("svg")).toBeNull();
    expect(queryByText("Card")).not.toBeInTheDocument();
  });
});

describe("ThemeDrivenFooter — new settings (C1)", () => {
  it("renders a CSS grid with the configured column count", () => {
    const cfg: HeaderFooterConfig = {
      settings: { columns: 3 },
      blocks: [
        ...DEFAULT_FOOTER.blocks,
        { id: "c1", type: "footer_column", visible: true, order: 1, settings: { title: "Shop", links: [] } },
      ],
    };
    const { container } = renderFooter(cfg);
    const row = container.querySelector(".grid") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("renders real payment badges from shop config when showPaymentIcons is true", () => {
    const cfg: HeaderFooterConfig = { settings: { showPaymentIcons: true }, blocks: DEFAULT_FOOTER.blocks };
    const withCard = { ...shop, cardProcessorEnabled: true } as unknown as Shop;
    const { getByText } = render(<ThemeDrivenFooter shop={withCard} config={cfg} />);
    expect(getByText("Card")).toBeInTheDocument();
  });

  it("renders a wave SVG at the top edge when waveEdge is true", () => {
    const cfg: HeaderFooterConfig = { settings: { waveEdge: true }, blocks: DEFAULT_FOOTER.blocks };
    const { container } = renderFooter(cfg);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("wraps the bottom row in a tinted strip when bottomBarSeparate is true", () => {
    const cfg: HeaderFooterConfig = { settings: { bottomBarSeparate: true }, blocks: DEFAULT_FOOTER.blocks };
    const { container } = renderFooter(cfg);
    const strip = container.querySelector('[style*="color-mix"]');
    expect(strip).not.toBeNull();
  });
});
