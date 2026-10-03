import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import TestimonialsSection, { resolveReviewQuery } from "./TestimonialsSection";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const listFeaturedReviews = vi.fn();
vi.mock("@/lib/api", () => ({
  listFeaturedReviews: (...args: unknown[]) => listFeaturedReviews(...args),
}));

let previewMode = false;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "shop", previewMode }),
}));

const block = (type: string, settings: Record<string, unknown>, order = 0): ThemeBlock =>
  ({ id: `${type}-${order}`, type, visible: true, order, settings }) as unknown as ThemeBlock;

const HEADING = block("heading", { text: "Customer reviews" });
// A testimonial block saved by an older theme: must never render.
const LEGACY = block("testimonial", { quote: "LEGACY INVENTED QUOTE", author: "Reem A.", rating: 5 }, 1);

function renderSection(settings: Partial<SectionSettings> = {}, blocks: ThemeBlock[] = [HEADING, LEGACY]) {
  return render(<TestimonialsSection sectionId="s" settings={settings as SectionSettings} blocks={blocks} />);
}

describe("TestimonialsSection (real reviews only)", () => {
  it("renders approved reviews and ignores legacy testimonial blocks", async () => {
    listFeaturedReviews.mockResolvedValue([{ name: "Sara K.", rating: 5, comment: "Lovely flowers", date: "2026-10-01T10:00:00.000Z" }]);
    renderSection();
    expect(await screen.findByText("Lovely flowers")).toBeInTheDocument();
    expect(screen.getByText("Sara K.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer reviews" })).toBeInTheDocument();
    expect(screen.queryByText("LEGACY INVENTED QUOTE")).toBeNull();
    expect(screen.queryByText("Reem A.")).toBeNull();
  });

  it("renders a hostile comment as inert text, not markup", async () => {
    const xss = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    listFeaturedReviews.mockResolvedValue([{ name: "Eve M.", rating: 4, comment: xss, date: "2026-10-01T10:00:00.000Z" }]);
    const { container } = renderSection();
    expect(await screen.findByText(xss)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("renders nothing at all on the live storefront with no approved review, even with legacy blocks", async () => {
    previewMode = false;
    listFeaturedReviews.mockResolvedValue([]);
    const { container } = renderSection();
    await waitFor(() => expect(listFeaturedReviews).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    previewMode = false;
    listFeaturedReviews.mockRejectedValue(new Error("404"));
    const { container } = renderSection();
    await new Promise((r) => setTimeout(r, 10));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an explanatory empty-state card in the theme editor preview", async () => {
    previewMode = true;
    listFeaturedReviews.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("No approved reviews yet")).toBeInTheDocument();
    expect(screen.getByText(/Show on store/)).toBeInTheDocument();
    previewMode = false;
  });

  it("passes max items and minimum rating, clamped", async () => {
    listFeaturedReviews.mockResolvedValue([]);
    renderSection({ maxItems: 9, minRating: 4 });
    await waitFor(() => expect(listFeaturedReviews).toHaveBeenCalledWith("shop", { limit: 9, minRating: 4 }));
  });
});

describe("resolveReviewQuery", () => {
  it("defaults when unset and clamps out-of-range values", () => {
    expect(resolveReviewQuery({} as SectionSettings)).toEqual({ limit: 6, minRating: undefined });
    expect(resolveReviewQuery({ maxItems: 99, minRating: 9 } as unknown as SectionSettings)).toEqual({ limit: 12, minRating: undefined });
    expect(resolveReviewQuery({ maxItems: 1, minRating: 3 } as unknown as SectionSettings)).toEqual({ limit: 3, minRating: 3 });
    expect(resolveReviewQuery({ maxItems: "x", minRating: "y" } as unknown as SectionSettings)).toEqual({ limit: 6, minRating: undefined });
  });
});
