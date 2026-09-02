import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ThemeDrivenHeader from "./ThemeDrivenHeader";
import type { HeaderFooterConfig } from "@/lib/theme-config-types";
import type { Shop } from "@/lib/types";

// Mirrors backend DEFAULT_THEME_CONFIG.header (the shape an untouched theme
// ships with) — no `settings.rows` key.
const CLASSIC_HEADER: HeaderFooterConfig = {
  settings: { sticky: false, transparentOnHero: false },
  blocks: [
    { id: "hdr-logo", type: "logo", visible: true, order: 0, settings: { zone: "left" } },
    { id: "hdr-nav-menu", type: "nav_menu", visible: true, order: 1, settings: {} },
    { id: "hdr-search", type: "search_icon", visible: true, order: 2, settings: { zone: "right" } },
    { id: "hdr-cart", type: "cart_icon", visible: true, order: 3, settings: { zone: "right" } },
    { id: "hdr-account", type: "account_icon", visible: true, order: 4, settings: { zone: "right" } },
  ],
};

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopBasePath: "", previewMode: false, themeConfig: null }),
}));
vi.mock("@/lib/cart-drawer", () => ({ useCartDrawer: () => ({ openDrawer: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ resolveImageUrl: (u: string | null) => u }));
vi.mock("@/components/SearchBar", () => ({ default: () => <span data-testid="search" /> }));
vi.mock("@/components/MenuBar", () => ({ default: () => <span data-testid="menubar" /> }));
vi.mock("./ThemeImageBlock", () => ({ default: () => <span data-testid="imageblock" /> }));
vi.mock("./SectionWrapper", () => ({ backgroundStyle: () => ({}) }));

afterEach(cleanup);

const shop = { displayName: "Test Shop", name: "test", logoUrl: null } as Shop;

function renderHeader(config: HeaderFooterConfig) {
  return render(<ThemeDrivenHeader shopSlug="test" shop={shop} customer={null} count={0} config={config} />);
}

describe("ThemeDrivenHeader — rows-absent regression (Phase 3)", () => {
  it("renders the classic single 3-zone grid, byte-for-byte, when settings.rows is absent", () => {
    const { container } = renderHeader(CLASSIC_HEADER);
    const grid = container.querySelector(".grid.grid-cols-3");
    expect(grid).not.toBeNull();
    // exactly the three zone columns
    expect(grid!.children).toHaveLength(3);
    // logo (falls back to the shop name span) is present
    expect(container.textContent).toContain("Test Shop");
    // no multi-row markup
    expect(container.querySelectorAll('[data-testid="menubar"]').length).toBe(0);
  });

  it("is unaffected by an empty rows array (still the classic grid)", () => {
    const cfg: HeaderFooterConfig = { ...CLASSIC_HEADER, settings: { ...CLASSIC_HEADER.settings, rows: [] } };
    const { container } = renderHeader(cfg);
    expect(container.querySelector(".grid.grid-cols-3")).not.toBeNull();
  });
});

describe("ThemeDrivenHeader — rows present (Phase 3)", () => {
  it("renders one bar per row and drops the 3-zone grid", () => {
    const cfg: HeaderFooterConfig = {
      settings: {
        rows: [
          { id: "r1", blockIds: ["hdr-contact"], align: "between" },
          { id: "r2", blockIds: ["hdr-logo", "hdr-nav-menu"], align: "center" },
        ],
      },
      blocks: [
        { id: "hdr-contact", type: "contact_bar_item", visible: true, order: 0, settings: { kind: "phone", value: "+971 4 000 0000", label: "Call us" } },
        { id: "hdr-logo", type: "logo", visible: true, order: 1, settings: {} },
        { id: "hdr-nav-menu", type: "nav_menu", visible: true, order: 2, settings: {} },
      ],
    };
    const { container, getByText, getAllByTestId } = renderHeader(cfg);
    expect(container.querySelector(".grid.grid-cols-3")).toBeNull();
    expect(getByText("Call us")).toBeInTheDocument();
    // nav_menu placed in a row renders the inline <MenuBar />
    expect(getAllByTestId("menubar").length).toBe(1);
  });
});
