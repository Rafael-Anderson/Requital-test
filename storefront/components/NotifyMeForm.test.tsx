import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotifyMeForm from "./NotifyMeForm";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  subscribeNotifyMe: vi.fn(),
}));
import { subscribeNotifyMe } from "@/lib/api";

describe("NotifyMeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an email input and submit button", () => {
    render(<NotifyMeForm productId={1} />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notify me" })).toBeInTheDocument();
  });

  it("submits productId, variantId and the typed email to the correct endpoint", async () => {
    const user = userEvent.setup();
    vi.mocked(subscribeNotifyMe).mockResolvedValue({ alreadySubscribed: false });
    render(<NotifyMeForm productId={5} variantId={9} />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "shopper@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    await waitFor(() => {
      expect(subscribeNotifyMe).toHaveBeenCalledWith(5, "shopper@example.com", 9);
    });
  });

  it("shows a confirmation message on success", async () => {
    const user = userEvent.setup();
    vi.mocked(subscribeNotifyMe).mockResolvedValue({ alreadySubscribed: false });
    render(<NotifyMeForm productId={1} />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "shopper@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByText(/you're on the list/i)).toBeInTheDocument();
  });

  it("shows a duplicate message when already subscribed", async () => {
    const user = userEvent.setup();
    vi.mocked(subscribeNotifyMe).mockResolvedValue({ alreadySubscribed: true });
    render(<NotifyMeForm productId={1} />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "shopper@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByText("You're already on the list.")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    const user = userEvent.setup();
    vi.mocked(subscribeNotifyMe).mockRejectedValue(new Error("Too many notify-me subscriptions from this email — try again later"));
    render(<NotifyMeForm productId={1} />);

    await user.type(screen.getByPlaceholderText("you@example.com"), "shopper@example.com");
    await user.click(screen.getByRole("button", { name: "Notify me" }));

    expect(await screen.findByText(/too many notify-me subscriptions/i)).toBeInTheDocument();
  });
});
