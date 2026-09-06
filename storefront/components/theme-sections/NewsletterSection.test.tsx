import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewsletterSection from "./NewsletterSection";
import { subscribeNewsletter } from "@/lib/api";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

let themeConfig: unknown = null;
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ previewMode: false, shop: null, shopSlug: "test-shop", themeConfig }),
}));
vi.mock("@/lib/api", () => ({ subscribeNewsletter: vi.fn() }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  vi.clearAllMocks();
});

const BLOCKS: ThemeBlock[] = [{ id: "blk-form", type: "email_form", visible: true, order: 0, settings: { buttonLabel: "Subscribe" } }];

function renderNewsletter(settings: SectionSettings = {} as SectionSettings) {
  return render(<NewsletterSection sectionId="sec-newsletter" settings={settings} blocks={BLOCKS} />);
}

async function submitEmail() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("you@example.com"), "hi@example.com");
  await user.click(screen.getByRole("button", { name: "Subscribe" }));
}

describe("NewsletterSection submit button hoverEffect/pressEffect (§8.7 item 1)", () => {
  it("renders no extra class and no icon when buttons.primary.hoverEffect is unset (no-op)", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).not.toContain("theme-btn-");
    expect(button.querySelector("svg")).toBeNull();
  });

  it("applies theme-btn-border-fill for 'border-fill'", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "border-fill" } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).toContain("theme-btn-border-fill");
  });

  it("renders a trailing arrow icon for 'icon-nudge' only", () => {
    themeConfig = { globalSettings: { buttons: { primary: { hoverEffect: "icon-nudge" } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("applies theme-btn-press when pressEffect is true", () => {
    themeConfig = { globalSettings: { buttons: { primary: { pressEffect: true } } } };
    renderNewsletter();
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button.className).toContain("theme-btn-press");
  });
});

describe("NewsletterSection successAnimation (§8.7 item 5)", () => {
  it("no-op: success renders the plain <p>, no animation class, no checkmark, when successAnimation is unset", async () => {
    themeConfig = { globalSettings: { buttons: { primary: {} } } };
    vi.mocked(subscribeNewsletter).mockResolvedValue({ alreadySubscribed: false });
    const { container } = renderNewsletter();
    await submitEmail();
    await waitFor(() => expect(screen.getByText("Thanks for subscribing!")).toBeInTheDocument());
    expect(container.querySelector(".theme-newsletter-success")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull(); // form gone
  });

  it("successAnimation on: success renders the animated div with a checkmark and the same text", async () => {
    themeConfig = { globalSettings: { buttons: { primary: {} } } };
    vi.mocked(subscribeNewsletter).mockResolvedValue({ alreadySubscribed: false });
    const { container } = renderNewsletter({ successAnimation: true } as SectionSettings);
    await submitEmail();
    await waitFor(() => expect(screen.getByText("Thanks for subscribing!")).toBeInTheDocument());
    const successEl = container.querySelector(".theme-newsletter-success");
    expect(successEl).not.toBeNull();
    expect(successEl!.querySelector("svg")).not.toBeNull();
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull(); // form gone
  });
});

describe("NewsletterSection inputFields.focusAnimation (§8.13.C item 7)", () => {
  it("no-op: unset ⇒ the bare placeholder input, no float-label wrapper", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} }, inputFields: {} } };
    const { container } = renderNewsletter();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(container.querySelector(".theme-float-label")).toBeNull();
  });

  it("'float-label' ⇒ a .theme-float-label <label> wrapping the input (placeholder is a space) + a floating span", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} }, inputFields: { focusAnimation: "float-label" } } };
    const { container } = renderNewsletter();
    const wrap = container.querySelector("label.theme-float-label");
    expect(wrap).not.toBeNull();
    expect(wrap!.querySelector('input[type="email"]')?.getAttribute("placeholder")).toBe(" ");
    expect(wrap!.querySelector("span")?.textContent).toBe("Email address");
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
  });

  it("an unbuilt value ('glow') falls through to the plain input", () => {
    themeConfig = { globalSettings: { buttons: { primary: {} }, inputFields: { focusAnimation: "glow" } } };
    const { container } = renderNewsletter();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(container.querySelector(".theme-float-label")).toBeNull();
  });
});
