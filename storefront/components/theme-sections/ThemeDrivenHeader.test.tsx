import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
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

describe("ThemeDrivenHeader — icon showLabel (C1)", () => {
  it("renders no text label by default (byte-identical to before showLabel existed)", () => {
    const { queryByText } = renderHeader(CLASSIC_HEADER);
    expect(queryByText("Cart")).not.toBeInTheDocument();
    expect(queryByText("Account")).not.toBeInTheDocument();
  });

  it("renders 'Cart'/'Account' text labels when each block's showLabel is true", () => {
    const cfg: HeaderFooterConfig = {
      ...CLASSIC_HEADER,
      blocks: CLASSIC_HEADER.blocks.map((b) =>
        b.type === "cart_icon" || b.type === "account_icon" ? { ...b, settings: { ...b.settings, showLabel: true } } : b,
      ),
    };
    const { getByText } = renderHeader(cfg);
    expect(getByText("Cart")).toBeInTheDocument();
    expect(getByText("Account")).toBeInTheDocument();
  });
});

describe("ThemeDrivenHeader — height/contentWidth (C1)", () => {
  it("defaults to today's py-3 classic padding and the var() max-width cap", () => {
    const { container } = renderHeader(CLASSIC_HEADER);
    const inner = container.querySelector(".grid.grid-cols-3") as HTMLElement;
    expect(inner.className).toContain("py-3");
    expect(inner.style.maxWidth).toBe("var(--theme-max-width, 80rem)");
  });

  it("applies a compact/tall padding class per settings.height", () => {
    const compact = renderHeader({ ...CLASSIC_HEADER, settings: { ...CLASSIC_HEADER.settings, height: "compact" } });
    expect((compact.container.querySelector(".grid.grid-cols-3") as HTMLElement).className).toContain("py-2");
    compact.unmount();
    const tall = renderHeader({ ...CLASSIC_HEADER, settings: { ...CLASSIC_HEADER.settings, height: "tall" } });
    expect((tall.container.querySelector(".grid.grid-cols-3") as HTMLElement).className).toContain("py-5");
  });

  it("drops the max-width cap when contentWidth is 'full'", () => {
    const { container } = renderHeader({ ...CLASSIC_HEADER, settings: { ...CLASSIC_HEADER.settings, contentWidth: "full" } });
    const inner = container.querySelector(".grid.grid-cols-3") as HTMLElement;
    expect(inner.style.maxWidth).toBe("");
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

describe("ThemeDrivenHeader — scrollBehavior precedence + 'shrink' (§8.7 item 2)", () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  function setScrollY(y: number) {
    Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  }

  afterEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  });

  it("no scrollBehavior falls back to the legacy sticky boolean, byte-identical", () => {
    const { container } = renderHeader({ ...CLASSIC_HEADER, settings: { ...CLASSIC_HEADER.settings, sticky: true } });
    expect(container.querySelector(".sticky.top-0")).not.toBeNull();
  });

  it("scrollBehavior: 'static' overrides a true legacy sticky boolean", () => {
    const { container } = renderHeader({ ...CLASSIC_HEADER, settings: { sticky: true, scrollBehavior: "static" } });
    expect(container.querySelector(".sticky.top-0")).toBeNull();
  });

  it("scrollBehavior: 'shrink' does not apply this div's own sticky (the ancestor <header> owns it)", () => {
    const { container } = renderHeader({ ...CLASSIC_HEADER, settings: { scrollBehavior: "shrink" } });
    expect(container.querySelector(".sticky.top-0")).toBeNull();
  });

  it("'shrink' swaps to compact padding past the threshold and back above it", () => {
    const { container } = renderHeader({ ...CLASSIC_HEADER, settings: { scrollBehavior: "shrink" } });
    const grid = container.querySelector(".grid.grid-cols-3") as HTMLElement;
    expect(grid.className).toContain("py-3"); // default, unscrolled
    act(() => setScrollY(100));
    expect(grid.className).toContain("py-2"); // compact, shrunk
    act(() => setScrollY(0));
    expect(grid.className).toContain("py-3");
  });
});
