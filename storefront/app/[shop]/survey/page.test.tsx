import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SurveyPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submitSurvey = vi.fn();
const withdrawSurveyConsent = vi.fn();
const lookupSurvey = vi.fn();
const OPEN = { shopName: "Rose Shop", rating: null, comment: null, respondedAt: null, publishConsent: null };
const ANSWERED = { shopName: "Rose Shop", rating: 5, comment: "Lovely", respondedAt: "2026-10-01T10:00:00.000Z" };
vi.mock("@/lib/api", () => ({
  lookupSurvey: (...args: unknown[]) => lookupSurvey(...args),
  submitSurvey: (...args: unknown[]) => submitSurvey(...args),
  withdrawSurveyConsent: (...args: unknown[]) => withdrawSurveyConsent(...args),
}));
beforeEach(() => {
  lookupSurvey.mockResolvedValue(OPEN);
});
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

describe("survey consent withdrawal", () => {
  it("shows the withdraw control after a consenting submit, then the confirmation once withdrawn", async () => {
    submitSurvey.mockResolvedValue({ success: true });
    withdrawSurveyConsent.mockResolvedValue({ withdrawn: true });
    render(<SurveyPage />);
    fireEvent.click(await screen.findByLabelText(/You may show my feedback/));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw my consent" }));
    await waitFor(() => expect(withdrawSurveyConsent).toHaveBeenCalledWith("abc"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your feedback will no longer be shown on the store's website.",
    );
    expect(screen.queryByRole("button", { name: "Withdraw my consent" })).toBeNull();
  });

  it("offers no withdraw control after an unticked submit", async () => {
    submitSurvey.mockResolvedValue({ success: true });
    render(<SurveyPage />);
    await screen.findByLabelText(/You may show my feedback/);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/not shown on the store's website/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw my consent" })).toBeNull();
  });

  it("an already answered survey with consent shows the control and no form to answer again", async () => {
    lookupSurvey.mockResolvedValue({ ...ANSWERED, publishConsent: true });
    render(<SurveyPage />);
    expect(await screen.findByRole("button", { name: "Withdraw my consent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.queryByLabelText(/You may show my feedback/)).toBeNull();
  });

  it("an already answered survey that declined or was withdrawn shows no control and cannot be re-granted", async () => {
    lookupSurvey.mockResolvedValue({ ...ANSWERED, publishConsent: false });
    render(<SurveyPage />);
    expect(await screen.findByText(/not shown on the store's website/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw my consent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("an answered survey with no recorded consent shows neither control nor message", async () => {
    lookupSurvey.mockResolvedValue({ ...ANSWERED, publishConsent: null });
    render(<SurveyPage />);
    await screen.findByText(/Thanks for your feedback/);
    expect(screen.queryByRole("button", { name: "Withdraw my consent" })).toBeNull();
    expect(screen.queryByText(/not shown on the store's website/)).toBeNull();
  });

  it("keeps the control and shows the error when the withdrawal fails", async () => {
    lookupSurvey.mockResolvedValue({ ...ANSWERED, publishConsent: true });
    withdrawSurveyConsent.mockRejectedValue(new Error("Request failed (500)"));
    render(<SurveyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw my consent" }));
    expect(await screen.findByText("Request failed (500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw my consent" })).not.toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
