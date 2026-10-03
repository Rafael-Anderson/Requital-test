import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReviewsPage from "./page";
import { listReviews, setReviewFeatured } from "@/lib/api";

vi.mock("@/lib/api", () => ({ listReviews: vi.fn(), setReviewFeatured: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/customers/reviews" }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

const base = {
  orderNumber: 1,
  customerName: "Sara Khan",
  respondedAt: "2026-10-01T10:00:00.000Z",
  featuredAt: null,
};
const REVIEWS = [
  { ...base, id: 1, rating: 5, comment: "Lovely", publishConsent: 1, canFeature: true },
  { ...base, id: 2, rating: 3, comment: "Fine", publishConsent: null, canFeature: false },
];

beforeEach(() => {
  vi.mocked(listReviews).mockResolvedValue({ data: REVIEWS, total: 2, page: 1, pageSize: 20 } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Reviews page", () => {
  it("disables the switch with an explanation when there is no consent, and lets a consenting row be featured", async () => {
    vi.mocked(setReviewFeatured).mockResolvedValue({ id: 1, featured: true });
    render(<ReviewsPage />);
    expect(await screen.findByText("Lovely")).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches[0]).not.toBeDisabled();
    expect(switches[1]).toBeDisabled();
    expect(screen.getByText("No consent recorded")).toBeInTheDocument();
    expect(screen.getByText(/did not agree to publish this feedback/)).toBeInTheDocument();
    fireEvent.click(switches[0]);
    await waitFor(() => expect(setReviewFeatured).toHaveBeenCalledWith(1, true));
  });
});
