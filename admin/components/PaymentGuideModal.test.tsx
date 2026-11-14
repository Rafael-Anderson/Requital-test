import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import PaymentGuideModal from "./PaymentGuideModal";
import {
  getPaymentGuide,
  NOMOD_WEBHOOK_EVENTS,
  PAYMENT_GUIDE_IDS,
  type PaymentGuideId,
} from "@/lib/payment-guides";
import { PROVIDER_CREDENTIAL_FIELDS, type PaymentGatewayProvider } from "@/lib/types";

afterEach(cleanup);

const NOMOD_URL = `http://api.test/payments/webhook/nomod/${"a".repeat(64)}`;

function open(guide: PaymentGuideId, webhookUrl?: string | null, label?: string) {
  render(<PaymentGuideModal guide={guide} webhookUrl={webhookUrl} buttonLabel={label} />);
  fireEvent.click(screen.getByRole("button", { name: label ?? "How to get your keys" }));
  return screen.getByRole("dialog");
}

describe.each([
  ["nomod", "Connect Nomod", NOMOD_URL],
  ["stripe", "Connect Stripe", "http://api.test/payments/webhook/stripe/7"],
  ["paypal", "Connect PayPal", "http://api.test/payments/webhook/paypal/7"],
  ["tabby", "Connect Tabby", null],
  ["tamara", "Connect Tamara", null],
] as const)("%s guide", (id, title, url) => {
  it("opens from the button and renders its steps as an ordered list", () => {
    const dialog = open(id, url);
    expect(within(dialog).getByText(title)).toBeInTheDocument();
    const list = dialog.querySelector("ol");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll(":scope > li")).toHaveLength(getPaymentGuide(id).steps.length);
  });
});

describe("Cash on Delivery guide", () => {
  it("opens from its button, explains it needs no keys and lists its steps", () => {
    const dialog = open("cod", null, "How it works");
    expect(within(dialog).getByText("Cash on Delivery")).toBeInTheDocument();
    expect(within(dialog).getByText(/needs no keys/)).toBeInTheDocument();
    expect(dialog.querySelectorAll("ol > li")).toHaveLength(getPaymentGuide("cod").steps.length);
  });
});

describe("Nomod guide content", () => {
  it("shows this shop's webhook URL and all 8 event names", () => {
    const dialog = open("nomod", NOMOD_URL);
    expect(within(dialog).getByText(NOMOD_URL)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    const events = [
      "charge.created",
      "charge.authorised",
      "charge.completed",
      "charge.failed",
      "charge.cancelled",
      "charge.refunded",
      "charge.partially_refunded",
      "charge.dispute.created",
    ];
    expect(events).toHaveLength(8);
    for (const e of events) expect(within(dialog).getByText(e)).toBeInTheDocument();
    expect(NOMOD_WEBHOOK_EVENTS).toEqual(events);
  });

  it("covers every step the owner specified, in order", () => {
    const text = getPaymentGuide("nomod").steps.map((s) => s.text);
    expect(text).toHaveLength(8);
    expect(text[1]).toMatch(/Settings > Tools & customisations > Apps & APIs/);
    expect(text[2]).toMatch(/never shows it again/);
    expect(text[3]).toMatch(/Nomod Hosted Checkout/);
    expect(text[5]).toMatch(/whsec_/);
    expect(text[6]).toMatch(/Test connection/);
    expect(text[7]).toMatch(/Stripe turns off/);
  });

  it("says where to get the URL when none has been generated yet", () => {
    const dialog = open("nomod", null);
    expect(within(dialog).getByText(/has not been generated yet/)).toBeInTheDocument();
  });
});

describe("guide accuracy against the real form", () => {
  it("every credential field a guide names exists on the form with exactly that label", () => {
    // Field labels each guide quotes, per method.
    const quoted: Record<string, string[]> = {
      nomod: ["API Key", "Webhook Signing Secret"],
      stripe: ["Secret Key", "Webhook Secret"],
      paypal: ["Client ID", "Client Secret", "Webhook ID"],
      tabby: ["Public Key", "Secret Key", "Webhook Secret", "Merchant Code"],
      tamara: ["API URL", "API Token", "Notification Token", "Public Key"],
    };
    for (const [id, labels] of Object.entries(quoted)) {
      const guide = JSON.stringify(getPaymentGuide(id as PaymentGuideId));
      const formLabels = PROVIDER_CREDENTIAL_FIELDS[id as PaymentGatewayProvider].map((f) => f.label);
      for (const label of labels) {
        expect(guide, `${id} guide mentions ${label}`).toContain(label);
        expect(formLabels.some((f) => f.startsWith(label)), `${id} form has ${label}`).toBe(true);
      }
    }
  });

  it("has a guide with steps for every method and no em dash in any copy", () => {
    expect(PAYMENT_GUIDE_IDS).toHaveLength(6);
    for (const id of PAYMENT_GUIDE_IDS) {
      const g = getPaymentGuide(id);
      expect(g.steps.length).toBeGreaterThan(0);
      expect(JSON.stringify(g)).not.toContain("—");
    }
  });

  it("falls back to English for a locale with no entry", () => {
    expect(getPaymentGuide("stripe", "ar")).toBe(getPaymentGuide("stripe", "en"));
  });
});

describe("accessibility", () => {
  it("is a real button, the dialog is labelled, and Close dismisses it", async () => {
    render(<PaymentGuideModal guide="stripe" webhookUrl="http://api.test/x" />);
    const trigger = screen.getByRole("button", { name: "How to get your keys" });
    expect(trigger.tagName).toBe("BUTTON");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Connect Stripe");
    expect(dialog.querySelector("ol")).not.toBeNull();
    const closers = within(dialog).getAllByRole("button", { name: "Close" });
    fireEvent.click(closers[closers.length - 1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Escape closes it", async () => {
    open("tabby");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
