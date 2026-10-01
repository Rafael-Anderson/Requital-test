import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import type { AnalyticsSettings } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getAnalyticsSettings: vi.fn(),
  updateAnalyticsSettings: vi.fn(),
}));
import { getAnalyticsSettings, updateAnalyticsSettings } from "@/lib/api";
import AnalyticsIntegrationsPage from "./page";

const base: AnalyticsSettings = {
  ga4MeasurementId: null,
  metaPixelId: null,
  metaCapiTokenSet: false,
  metaTestEventCode: null,
  tiktokPixelId: null,
  snapPixelId: null,
  googleAdsConversionId: null,
  googleAdsConversionLabel: null,
};

function renderPage() {
  return render(
    <ToastProvider>
      <AnalyticsIntegrationsPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getAnalyticsSettings).mockReset();
  vi.mocked(updateAnalyticsSettings).mockReset();
});

describe("Analytics & Pixels page", () => {
  it("a saved token is shown only as 'Saved (hidden)', never as a value", async () => {
    vi.mocked(getAnalyticsSettings).mockResolvedValue({ ...base, metaPixelId: "123456789012345", metaCapiTokenSet: true });
    renderPage();
    expect(await screen.findByText("Saved (hidden)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123456789012345")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Paste your access token")).not.toBeInTheDocument();
  });

  it("saving without typing a token never sends one; empty ids go as null (clear)", async () => {
    const user = userEvent.setup();
    vi.mocked(getAnalyticsSettings).mockResolvedValue({ ...base, metaCapiTokenSet: true, tiktokPixelId: "CABCDEFGHIJKLMNOPQRS" });
    vi.mocked(updateAnalyticsSettings).mockResolvedValue({ ...base, metaCapiTokenSet: true });
    renderPage();
    await screen.findByText("Saved (hidden)");
    await user.clear(screen.getByDisplayValue("CABCDEFGHIJKLMNOPQRS"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAnalyticsSettings).toHaveBeenCalled());
    const sent = vi.mocked(updateAnalyticsSettings).mock.calls[0][0];
    expect(sent).not.toHaveProperty("metaCapiToken");
    expect(sent.tiktokPixelId).toBeNull();
    expect(sent.ga4MeasurementId).toBeNull();
  });

  it("sends a typed token once, then clears the input", async () => {
    const user = userEvent.setup();
    vi.mocked(getAnalyticsSettings).mockResolvedValue(base);
    vi.mocked(updateAnalyticsSettings).mockResolvedValue({ ...base, metaCapiTokenSet: true });
    renderPage();
    const input = await screen.findByPlaceholderText("Paste your access token");
    await user.type(input, "EAAB" + "x".repeat(30));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAnalyticsSettings).toHaveBeenCalled());
    expect(vi.mocked(updateAnalyticsSettings).mock.calls[0][0].metaCapiToken).toBe("EAAB" + "x".repeat(30));
    expect(await screen.findByText("Saved (hidden)")).toBeInTheDocument();
  });

  it("blocks a malformed id client-side without calling the API", async () => {
    const user = userEvent.setup();
    vi.mocked(getAnalyticsSettings).mockResolvedValue(base);
    renderPage();
    await user.type(await screen.findByPlaceholderText("G-XXXXXXXXXX"), "UA-123");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateAnalyticsSettings).not.toHaveBeenCalled();
    expect(await screen.findByText("Looks like G-XXXXXXXXXX")).toBeInTheDocument();
  });
});
