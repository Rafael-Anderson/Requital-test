import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CollectionNav from "./CollectionNav";

let themeConfig: unknown = null;
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "s", shopBasePath: "", previewToken: undefined, themeConfig }),
}));
vi.mock("@/lib/api", () => ({
  listCollections: vi.fn().mockResolvedValue([
    { id: 1, name: "Roses", slug: "roses", parentCollectionId: null },
    { id: 2, name: "Tulips", slug: "tulips", parentCollectionId: null },
  ]),
}));

afterEach(() => {
  cleanup();
  themeConfig = null;
});

const themed = (style?: string) => ({ header: { blocks: [{ type: "nav_menu", settings: style ? { style } : {} }] } });

describe("CollectionNav (N4)", () => {
  it("default: the full-width bar with its border, wrapper and grey pills (unchanged)", async () => {
    const { container } = render(<CollectionNav />);
    const link = await screen.findByRole("link", { name: "Roses" });
    expect(container.firstElementChild!.tagName).toBe("NAV");
    expect(container.firstElementChild!.className).toContain("border-t");
    expect(link.className).toContain("rounded-full");
    expect(link.className).toContain("text-zinc-600");
  });

  it("inline: no border or page-width wrapper, and it may shrink inside its header cell (it overflowed into the logo)", async () => {
    const { container } = render(<CollectionNav inline />);
    await screen.findByRole("link", { name: "Roses" });
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.className).toContain("min-w-0");
    expect(root.className).not.toContain("border-t");
    expect(root.innerHTML).not.toContain("max-w-7xl");
  });

  it("follows the nav_menu block's link style instead of fixed grey pills (illegible on a dark band)", async () => {
    themeConfig = themed("caps");
    render(<CollectionNav inline />);
    const link = await screen.findByRole("link", { name: "Roses" });
    expect(link.className).toContain("uppercase");
    expect(link.className).not.toContain("text-zinc-600");
  });

  it("a themed shop's scroll chevrons use the header text colour, not the legacy teal", async () => {
    themeConfig = themed();
    render(<CollectionNav />);
    await screen.findByRole("link", { name: "Roses" });
    const arrow = screen.getByRole("button", { name: "Scroll collections left" });
    expect(arrow.className).toContain("opacity-70");
    expect(arrow.className).not.toContain("--color-collection-arrow");
  });
});
