import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ElementSettingsPanel from "./ElementSettingsPanel";
import type { ThemeBlock } from "@/lib/types";

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  resolveImageUrl: (path: string | null) => path,
  uploadThemeImage: vi.fn(),
}));

function block(type: string, settings: Record<string, unknown> = {}): ThemeBlock {
  return { id: `blk-${type}`, type, visible: true, order: 0, settings };
}

// One test per family — confirms ElementSettingsPanel routes each block
// type to the right control set (Part 2's family dispatch), and that a
// type outside all 5 families still falls back to the plain
// BlockSettingsForm rather than rendering nothing.
describe("ElementSettingsPanel — per-elementType dispatch", () => {
  it("heading (TEXT family) shows content + typography controls", () => {
    render(<ElementSettingsPanel block={block("heading", { text: "Hi" })} onUpdate={() => {}} />);
    expect(screen.getByLabelText("Text content")).toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("Letter spacing")).toBeInTheDocument();
  });

  it("product_title (TEXT family) shows style controls but no content field — driven by real product data", () => {
    render(<ElementSettingsPanel block={block("product_title")} onUpdate={() => {}} />);
    expect(screen.queryByLabelText("Text content")).not.toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
  });

  it("logo (IMAGE family) shows alt text + object fit + width", () => {
    render(<ElementSettingsPanel block={block("logo")} onUpdate={() => {}} />);
    expect(screen.getByLabelText("Alt text")).toBeInTheDocument();
    expect(screen.getByLabelText("Object fit")).toBeInTheDocument();
    expect(screen.getByText("Width")).toBeInTheDocument();
  });

  it("cta (BUTTON family) shows button text + background/border controls", () => {
    render(<ElementSettingsPanel block={block("cta", { label: "Shop now" })} onUpdate={() => {}} />);
    expect(screen.getByLabelText("Button text")).toHaveValue("Shop now");
    expect(screen.getByText("Background color")).toBeInTheDocument();
    expect(screen.getByText("Full width")).toBeInTheDocument();
  });

  it("nav_menu (NAV family) shows hover color + show-on-mobile toggle", () => {
    render(<ElementSettingsPanel block={block("nav_menu")} onUpdate={() => {}} />);
    expect(screen.getByText("Hover color")).toBeInTheDocument();
    expect(screen.getByText("Show on mobile")).toBeInTheDocument();
  });

  it("product_price (PRICE family) shows the currency toggle", () => {
    render(<ElementSettingsPanel block={block("product_price")} onUpdate={() => {}} />);
    expect(screen.getByText("Show currency code")).toBeInTheDocument();
  });

  it("falls back to BlockSettingsForm's own content for a type outside all 5 families", () => {
    render(<ElementSettingsPanel block={block("footer_social")} onUpdate={() => {}} />);
    expect(screen.getByText(/Shows the icons for whichever social links/)).toBeInTheDocument();
    expect(screen.queryByText("Font size")).not.toBeInTheDocument();
  });

  it("calls onUpdate with the field key and new value when a text field changes", () => {
    const onUpdate = vi.fn();
    render(<ElementSettingsPanel block={block("heading", { text: "Hi" })} onUpdate={onUpdate} />);
    const input = screen.getByLabelText("Text content");
    fireEvent.change(input, { target: { value: "New heading" } });
    expect(onUpdate).toHaveBeenCalledWith("text", "New heading");
  });
});
