import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchBar from "./SearchBar";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopSlug: "test-shop", shopBasePath: "", shop: { currency: "AED" } }),
}));

vi.mock("@/lib/api", () => ({
  searchProducts: vi.fn(),
  resolveImageUrl: (u: string) => u,
}));
import { searchProducts } from "@/lib/api";

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Search" }));
  return screen.getByPlaceholderText("Search products…");
}

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debounces input before calling the search endpoint", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue({ results: [], nextCursor: null, matchType: "none", suggestion: null });
    render(<SearchBar />);

    const input = await openSearch(user);
    await user.type(input, "rose");

    // Not called yet — still inside the (real-time, 300ms) debounce window.
    expect(searchProducts).not.toHaveBeenCalled();

    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith("test-shop", "rose"));
  });

  it("shows a loading state while the search is in flight", async () => {
    const user = userEvent.setup();
    let resolveSearch: (v: unknown) => void = () => {};
    vi.mocked(searchProducts).mockReturnValue(new Promise((resolve) => (resolveSearch = resolve)) as never);
    render(<SearchBar />);

    const input = await openSearch(user);
    await user.type(input, "rose");

    await waitFor(() => expect(screen.getByText("Searching…")).toBeInTheDocument());
    resolveSearch({ results: [], nextCursor: null, matchType: "none", suggestion: null });
  });

  it("renders results returned from the search endpoint", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue({
      results: [{ id: 1, name: "Rose Bouquet", slug: "rose-bouquet", thumbnail: "t.jpg", price: "50" }],
      nextCursor: null,
      matchType: "exact",
      suggestion: null,
    });
    render(<SearchBar />);

    const input = await openSearch(user);
    await user.type(input, "rose");

    expect(await screen.findByText("Rose Bouquet")).toBeInTheDocument();
  });

  it('shows a "Did you mean" suggestion on a near-miss fuzzy match', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue({
      results: [{ id: 1, name: "Rose Bouquet", slug: "rose-bouquet", thumbnail: "t.jpg", price: "50" }],
      nextCursor: null,
      matchType: "fuzzy",
      suggestion: "Rose Bouquet",
    });
    render(<SearchBar />);

    const input = await openSearch(user);
    await user.type(input, "roes");

    expect(await screen.findByText(/did you mean/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rose Bouquet" })).toBeInTheDocument();
  });

  it("shows a no-results message when nothing matches", async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue({ results: [], nextCursor: null, matchType: "none", suggestion: null });
    render(<SearchBar />);

    const input = await openSearch(user);
    await user.type(input, "zzz");

    expect(await screen.findByText("No products found.")).toBeInTheDocument();
  });
});
