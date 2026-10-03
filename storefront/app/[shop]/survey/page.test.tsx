import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SurveyPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submitSurvey = vi.fn();
vi.mock("@/lib/api", () => ({
  lookupSurvey: () => Promise.resolve({ shopName: "Rose Shop", rating: null, comment: null, respondedAt: null }),
  submitSurvey: (...args: unknown[]) => submitSurvey(...args),
}));
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ shop: { name: "Rose Shop" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("token=abc") }));
vi.mock("@/components/StorefrontPageShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

describe("survey form publish consent", () => {
  it("is unchecked by default and sends false when left unticked", async () => {
    submitSurvey.mockResolvedValue({ success: true });
    render(<SurveyPage />);
    const box = (await screen.findByLabelText(/You may show my feedback on the store's website\./)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(submitSurvey).toHaveBeenCalledWith("abc", { rating: 4, comment: undefined, publishConsent: false }));
  });

  it("sends true when ticked", async () => {
    submitSurvey.mockResolvedValue({ success: true });
    render(<SurveyPage />);
    fireEvent.click(await screen.findByLabelText(/You may show my feedback/));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(submitSurvey).toHaveBeenCalledWith("abc", { rating: 5, comment: undefined, publishConsent: true }));
  });
});
