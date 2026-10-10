import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Outlet, Shop } from "./types";
import type { ThemeConfig } from "./theme-config-types";
import type { ShopInitialData } from "./shop-initial-data";

let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/s",
  useSearchParams: () => new URLSearchParams(search),
}));

const getShop = vi.fn();
const listOutlets = vi.fn();
const getThemeConfig = vi.fn();
vi.mock("./api", () => ({
  getShop: (...a: unknown[]) => getShop(...a),
  listOutlets: (...a: unknown[]) => listOutlets(...a),
  getThemeConfig: (...a: unknown[]) => getThemeConfig(...a),
  listActiveAutoDiscounts: () => Promise.resolve([]),
  getRegions: () => Promise.resolve({ regions: [], country: null }),
}));

import { ShopProvider, useShop } from "./shop-context";

const seedShop = { id: 1, name: "Seeded Florist", displayName: null, published: true, colors: null } as unknown as Shop;
const seed: ShopInitialData = {
  shopSlug: "s",
  shop: seedShop,
  outlets: [{ id: 5 }] as unknown as Outlet[],
  themeConfig: { sections: [] } as unknown as ThemeConfig,
};

function Probe() {
  const { shop, loading, outlets, themeConfig } = useShop();
  return (
    <p data-testid="probe">
      {loading ? "loading" : "ready"}|{shop?.name ?? "none"}|{outlets.length}|{themeConfig ? "theme" : "no-theme"}
    </p>
  );
}

beforeEach(() => {
  search = "";
  getShop.mockReset().mockResolvedValue({ ...seedShop, name: "Fetched Florist" });
  listOutlets.mockReset().mockResolvedValue([]);
  getThemeConfig.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("ShopProvider with initial data", () => {
  it("renders the shop on the server pass (no loading state in the HTML)", () => {
    const html = renderToString(
      <ShopProvider shopSlug="s" initialData={seed}>
        <Probe />
      </ShopProvider>,
    );
    expect(html).toContain("ready");
    expect(html).toContain("Seeded Florist");
  });

  it("does not refetch what the server just rendered", async () => {
    render(
      <ShopProvider shopSlug="s" initialData={seed}>
        <Probe />
      </ShopProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("ready|Seeded Florist|1|theme");
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("ready|Seeded Florist|1|theme"));
    expect(getShop).not.toHaveBeenCalled();
    expect(listOutlets).not.toHaveBeenCalled();
    expect(getThemeConfig).not.toHaveBeenCalled();
  });

  it("without initial data it loads as it always did", async () => {
    render(
      <ShopProvider shopSlug="s">
        <Probe />
      </ShopProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toMatch(/^loading\|none/);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^ready\|Fetched Florist/));
    expect(getShop).toHaveBeenCalledTimes(1);
  });

  it("a theme-builder preview iframe ignores the published seed and fetches the draft", async () => {
    search = "preview=true&themeId=9&previewToken=tok";
    render(
      <ShopProvider shopSlug="s" initialData={seed}>
        <Probe />
      </ShopProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toMatch(/^loading\|none/);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^ready\|Fetched Florist/));
    expect(listOutlets).toHaveBeenCalledWith("s", "tok");
    expect(getThemeConfig).toHaveBeenCalledWith("s", { preview: true, themeId: 9 });
  });

  it("ignores a seed that belongs to another shop", async () => {
    render(
      <ShopProvider shopSlug="other" initialData={seed}>
        <Probe />
      </ShopProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toMatch(/^loading\|none/);
    await waitFor(() => expect(getShop).toHaveBeenCalledWith("other"));
  });
});
