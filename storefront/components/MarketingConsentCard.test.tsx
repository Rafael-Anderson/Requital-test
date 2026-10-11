import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MarketingConsentCard from "./MarketingConsentCard";

afterEach(cleanup);

vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ shopSlug: "test-shop" }) }));
vi.mock("@/lib/api", () => ({ getMyConsent: vi.fn(), setMyConsent: vi.fn() }));
import { getMyConsent, setMyConsent } from "@/lib/api";

const view = {
  wording: {
    version: "v1",
    channels: { email: "Email wording", whatsapp: "WhatsApp wording", sms: "SMS wording" },
  },
  channels: [
    { channel: "email" as const, status: null },
    { channel: "whatsapp" as const, status: "granted" as const },
    { channel: "sms" as const, status: "withdrawn" as const },
  ],
};

describe("MarketingConsentCard", () => {
  it("pre-ticks nothing for a customer who never answered, and ticks only what was granted", async () => {
    vi.mocked(getMyConsent).mockResolvedValue(view);
    render(<MarketingConsentCard />);
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, false]);
    expect(screen.getByText("Email wording")).toBeInTheDocument();
  });

  it("sends only the channel and the boolean", async () => {
    vi.mocked(getMyConsent).mockResolvedValue(view);
    vi.mocked(setMyConsent).mockResolvedValue({
      channels: [{ channel: "email", status: "granted" }, ...view.channels.slice(1)],
    });
    render(<MarketingConsentCard />);
    const [email] = await screen.findAllByRole("checkbox");
    await userEvent.click(email);
    expect(setMyConsent).toHaveBeenCalledWith("test-shop", "email", true);
    await waitFor(() => expect((email as HTMLInputElement).checked).toBe(true));
  });

  it("renders nothing when the preferences cannot be loaded", async () => {
    vi.mocked(getMyConsent).mockRejectedValue(new Error("boom"));
    const { container } = render(<MarketingConsentCard />);
    await waitFor(() => expect(getMyConsent).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
