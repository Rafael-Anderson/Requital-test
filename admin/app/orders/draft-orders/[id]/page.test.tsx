import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DraftOrderDetailPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getDraftOrder } from "@/lib/api";
import { whatsappShareUrl } from "@/lib/draft-share";
import type { DraftOrder } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDraftOrder: vi.fn(),
  cancelDraftOrder: vi.fn(),
  cancelDraftPaymentLink: vi.fn(),
  convertDraftCod: vi.fn(),
  emailDraftInvoice: vi.fn(),
  markDraftPaid: vi.fn(),
  sendDraftPaymentLink: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "5" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/DraftOrderBuilder", () => ({ default: () => null }));

const draft = (over: Partial<DraftOrder> = {}): DraftOrder =>
  ({
    id: 5,
    status: "OPEN",
    outletId: 1,
    outlet: { id: 1, name: "Main" },
    currency: "AED",
    customerName: "Layla",
    customerPhone: "+971 50 111 2233",
    customerEmail: null,
    customerAddress: "Villa 7",
    orderType: "delivery",
    items: [],
    bill: null,
    billError: null,
    billLocked: false,
    payLink: null,
    cardAvailable: true,
    orders: [],
    createdBy: null,
    ...over,
  }) as unknown as DraftOrder;

function renderPage() {
  return render(
    <ToastProvider>
      <DraftOrderDetailPage />
    </ToastProvider>,
  );
}

describe("DraftOrderDetailPage", () => {
  it("a failed load shows the error and no skeleton (it used to load forever)", async () => {
    vi.mocked(getDraftOrder).mockRejectedValue(new Error("Draft order not found"));
    const { container } = renderPage();
    expect(await screen.findByText("Draft order not found")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("shows the skeleton while it is still loading", () => {
    vi.mocked(getDraftOrder).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("disables the card link without a working card processor and points to Payments; COD and Mark as paid stay", async () => {
    vi.mocked(getDraftOrder).mockResolvedValue(draft({ cardAvailable: false }));
    renderPage();
    expect(await screen.findByRole("button", { name: "Card payment link" })).toBeDisabled();
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Integrations > Payments/ })).toHaveAttribute("href", "/integrations/payments");
    expect(screen.getByRole("button", { name: /Cash on delivery/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mark as paid" })).toBeEnabled();
  });

  it("enables the card link with a working processor", async () => {
    vi.mocked(getDraftOrder).mockResolvedValue(draft());
    renderPage();
    expect(await screen.findByRole("button", { name: "Card payment link" })).toBeEnabled();
  });

  it("with a link out: copy, WhatsApp share to the customer's number with shop total and link", async () => {
    vi.mocked(getDraftOrder).mockResolvedValue(
      draft({
        status: "INVOICE_SENT",
        payLink: { url: "https://shop.requital.io/pay/abc", sentAt: null, expiresAt: null, lockedAt: null },
        bill: {
          currency: "AED",
          taxInclusive: false,
          lines: [],
          subtotal: "100",
          discount: { amount: "0", source: null, code: null, reason: null },
          deliveryFee: "15",
          deliveryFeeSource: "zone",
          deliveryZone: null,
          deliveryError: null,
          taxAmount: "5",
          total: "120",
          stockWarnings: [],
        },
      }),
    );
    renderPage();
    const wa = await screen.findByRole("link", { name: /Share on WhatsApp/ });
    const href = wa.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/971501112233?text=")).toBe(true);
    expect(decodeURIComponent(href.split("text=")[1])).toContain("https://shop.requital.io/pay/abc");
    expect(screen.getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
    // Email needs an address
    expect(screen.getByRole("button", { name: /Email invoice/ })).toBeDisabled();
  });
});

describe("whatsappShareUrl", () => {
  it("keeps digits only and encodes the message", () => {
    expect(whatsappShareUrl("+971 (50) 1-2", "a b&c")).toBe("https://wa.me/9715012?text=a%20b%26c");
    expect(whatsappShareUrl(null, "x")).toBe("https://wa.me/?text=x");
  });
});
