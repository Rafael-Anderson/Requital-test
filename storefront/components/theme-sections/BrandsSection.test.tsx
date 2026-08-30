import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BrandsSection from "./BrandsSection";
import type { SectionSettings } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const listBrands = vi.fn();

vi.mock("@/lib/api", () => ({
  listBrands: (...args: unknown[]) => listBrands(...args),
  resolveImageUrl: (u: string | null) => u,
}));

let previewMode = false;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "shop", previewToken: undefined, previewMode }),
}));

const BRANDS = [
  { id: 1, name: "Rosewood", logoUrl: "https://cdn.test/rosewood.png" },
  { id: 2, name: "Petal Co", logoUrl: "https://cdn.test/petal.png" },
  { id: 3, name: "Bloom", logoUrl: null },
];

function renderSection(settings: Partial<SectionSettings>) {
  return render(<BrandsSection sectionId="sec-brands" settings={settings as SectionSettings} blocks={[]} />);
}

describe("BrandsSection", () => {
  it("renders every returned brand when no brandIds are set", async () => {
    listBrands.mockResolvedValue(BRANDS);
    renderSection({});
    expect(await screen.findByAltText("Rosewood")).toBeInTheDocument();
    expect(screen.getByAltText("Petal Co")).toBeInTheDocument();
    // logoUrl null -> name shown as text
    expect(screen.getByText("Bloom")).toBeInTheDocument();
  });

  it("shows only the selected brands, in the configured order", async () => {
    listBrands.mockResolvedValue(BRANDS);
    renderSection({ brandIds: ["2", "1"] });
    const logos = await screen.findAllByRole("img");
    expect(logos.map((el) => el.getAttribute("alt"))).toEqual(["Petal Co", "Rosewood"]);
  });

  it("renders a heading when set", async () => {
    listBrands.mockResolvedValue(BRANDS);
    renderSection({ heading: "Shop by brand" });
    expect(await screen.findByRole("heading", { name: "Shop by brand" })).toBeInTheDocument();
  });

  it("renders nothing on the live storefront when the shop has no brands", async () => {
    previewMode = false;
    listBrands.mockResolvedValue([]);
    const { container } = renderSection({});
    // give the effect a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("shows a builder-preview placeholder when there are no brands", async () => {
    previewMode = true;
    listBrands.mockResolvedValue([]);
    renderSection({});
    expect(await screen.findByText(/No brands yet/i)).toBeInTheDocument();
    previewMode = false;
  });
});
