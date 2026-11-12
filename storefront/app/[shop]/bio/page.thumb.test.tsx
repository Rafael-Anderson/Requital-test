import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import BioPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "s", loading: false, shop: { name: "Shop", displayName: "Shop" } }),
}));
vi.mock("@/lib/bio-page", () => ({
  resolveBioPageDisplay: () => ({ logoUrl: null, backgroundUrl: null, description: null }),
}));
vi.mock("@/components/StorefrontLoadingSkeleton", () => ({ default: () => <div>loading</div> }));
vi.mock("@/lib/api", () => ({
  resolveImageUrl: (p: string | null | undefined) => p ?? null,
  bioLinkClickUrl: (id: number) => `/click/${id}`,
  getBioPageConfig: () => Promise.resolve({ logoUrl: null, backgroundUrl: null, description: null, metaTitle: null, metaDescription: null }),
  getBioLinks: () =>
    Promise.resolve([
      { id: 1, type: "COLLECTION", label: "With icon", collection: { name: "A", slug: "a", image: "/banner-a.jpg", icon: "/icon-a.png" } },
      { id: 2, type: "COLLECTION", label: "Banner only", collection: { name: "B", slug: "b", image: "/banner-b.jpg", icon: null } },
    ]),
}));

describe("bio page: collection links use the Icon", () => {
  it("shows the Icon, and falls back to the banner when the collection has no Icon", async () => {
    const { container } = render(<BioPage />);
    await waitFor(() => expect(container.querySelectorAll("a img").length).toBe(2));
    expect(Array.from(container.querySelectorAll("a img")).map((i) => i.getAttribute("src"))).toEqual(["/icon-a.png", "/banner-b.jpg"]);
  });
});
