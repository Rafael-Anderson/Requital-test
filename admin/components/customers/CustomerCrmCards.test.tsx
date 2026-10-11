import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerConsentCard from "./CustomerConsentCard";
import CustomerNotesCard from "./CustomerNotesCard";
import CustomerTagsCard from "./CustomerTagsCard";
import { ToastProvider } from "@/components/ui/Toast";
import * as api from "@/lib/api";
import type { CustomerConsent } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getCustomerConsent: vi.fn(),
  recordCustomerConsent: vi.fn(),
  listCustomerNotes: vi.fn(),
  addCustomerNote: vi.fn(),
  deleteCustomerNote: vi.fn(),
  getCustomerTags: vi.fn(),
  listCustomerTags: vi.fn(),
  createCustomerTag: vi.fn(),
  assignCustomerTags: vi.fn(),
  unassignCustomerTags: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

const unknownConsent: CustomerConsent = {
  channels: [
    { channel: "email", status: null, source: null, wordingVersion: null, updatedAt: null },
    { channel: "whatsapp", status: null, source: null, wordingVersion: null, updatedAt: null },
    { channel: "sms", status: null, source: null, wordingVersion: null, updatedAt: null },
  ],
  newsletter: { subscribed: true, since: "2026-01-01T00:00:00Z", source: "newsletter_widget" },
  history: [],
};

describe("CustomerConsentCard", () => {
  it("shows unknown as 'Not asked' on every channel, never as a refusal, and keeps the newsletter separate", async () => {
    vi.mocked(api.getCustomerConsent).mockResolvedValue(unknownConsent);
    wrap(<CustomerConsentCard customerId={1} canEdit />);
    await waitFor(() => expect(screen.getAllByText(/Not asked/)).toHaveLength(3));
    expect(screen.queryByText(/Withdrawn/)).not.toBeInTheDocument();
    expect(screen.getByText(/not counted above/)).toBeInTheDocument();
  });

  it("will not record a consent without saying how it was obtained", async () => {
    vi.mocked(api.getCustomerConsent).mockResolvedValue(unknownConsent);
    vi.mocked(api.recordCustomerConsent).mockResolvedValue(unknownConsent);
    wrap(<CustomerConsentCard customerId={1} canEdit />);
    await waitFor(() => expect(screen.getAllByText("Record consent")).toHaveLength(3));
    await userEvent.click(screen.getAllByText("Record consent")[0]);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("How was consent obtained?"), "verbal, in store");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(api.recordCustomerConsent).toHaveBeenCalledWith(1, {
      channel: "email",
      status: "granted",
      note: "verbal, in store",
    });
  });

  it("offers no editing to a viewer", async () => {
    vi.mocked(api.getCustomerConsent).mockResolvedValue(unknownConsent);
    wrap(<CustomerConsentCard customerId={1} canEdit={false} />);
    await waitFor(() => expect(screen.getAllByText(/Not asked/)).toHaveLength(3));
    expect(screen.queryByText("Record consent")).not.toBeInTheDocument();
  });

  it("leaves the skeleton and offers Try again when the request fails", async () => {
    vi.mocked(api.getCustomerConsent).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(unknownConsent);
    wrap(<CustomerConsentCard customerId={1} canEdit />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.getCustomerConsent).toHaveBeenCalledTimes(2));
  });
});

describe("CustomerNotesCard", () => {
  it("fails visibly, and retries", async () => {
    vi.mocked(api.listCustomerNotes).mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    wrap(<CustomerNotesCard customerId={1} canEdit />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.listCustomerNotes).toHaveBeenCalledTimes(2));
  });

  it("shows author and time, says staff only, and a viewer cannot add or delete", async () => {
    vi.mocked(api.listCustomerNotes).mockResolvedValue([
      { id: 1, authorUserId: 1, authorName: "Ada", body: "Allergic to lilies", createdAt: "2026-10-01T10:00:00Z" },
    ]);
    wrap(<CustomerNotesCard customerId={1} canEdit={false} />);
    expect(await screen.findByText("Allergic to lilies")).toBeInTheDocument();
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText(/Never shown to the customer/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete note")).not.toBeInTheDocument();
  });
});

describe("CustomerTagsCard", () => {
  it("renders assigned tags even when the shop tag list fails to load", async () => {
    vi.mocked(api.getCustomerTags).mockResolvedValue([{ id: 1, name: "VIP", color: null }]);
    vi.mocked(api.listCustomerTags).mockRejectedValue(new Error("boom"));
    wrap(<CustomerTagsCard customerId={1} canEdit />);
    expect(await screen.findByText("VIP")).toBeInTheDocument();
  });
});
