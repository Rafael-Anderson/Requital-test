import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PolicyPage from "./page";

afterEach(cleanup);

let mockType = "privacy";
vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "test-shop", type: mockType }),
}));

vi.mock("@/lib/api", () => ({
  getPolicyPage: vi.fn(),
}));
import { getPolicyPage } from "@/lib/api";

describe("PolicyPage", () => {
  it("renders the merchant's saved content when published", async () => {
    mockType = "privacy";
    vi.mocked(getPolicyPage).mockResolvedValue({
      type: "PRIVACY",
      content: "<p>We respect your privacy.</p>",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    render(<PolicyPage />);

    expect(await screen.findByText("We respect your privacy.")).toBeInTheDocument();
  });

  it("renders a placeholder 'not published' state when the shop has no content for this type", async () => {
    mockType = "refund";
    vi.mocked(getPolicyPage).mockRejectedValue(new Error("Request failed (404)"));

    render(<PolicyPage />);

    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.getByText(/hasn't published this page yet/i)).toBeInTheDocument();
  });
});
