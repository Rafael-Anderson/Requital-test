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

const noop = () => {};

// One test per family — confirms ElementSettingsPanel routes each block
// type to the right control set (Part 2's family dispatch), and that a
// type outside all 6 families still falls back to the plain
// BlockSettingsForm rather than rendering nothing.
describe("ElementSettingsPanel — per-elementType dispatch", () => {
  it("heading (TEXT family) shows content + typography controls", () => {
    render(<ElementSettingsPanel block={block("heading", { text: "Hi" })} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByLabelText("Text content")).toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("Letter spacing")).toBeInTheDocument();
  });

  it("product_title (TEXT family) shows style controls but no content field — driven by real product data", () => {
    render(<ElementSettingsPanel block={block("product_title")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.queryByLabelText("Text content")).not.toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
  });

  it("logo (IMAGE family) shows alt text + object fit + width", () => {
    render(<ElementSettingsPanel block={block("logo")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByLabelText("Alt text")).toBeInTheDocument();
    expect(screen.getByLabelText("Object fit")).toBeInTheDocument();
    expect(screen.getByText("Width")).toBeInTheDocument();
  });

  it("cta (BUTTON family) shows button text + background/border controls", () => {
    render(<ElementSettingsPanel block={block("cta", { label: "Shop now" })} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByLabelText("Button text")).toHaveValue("Shop now");
    expect(screen.getByText("Background color")).toBeInTheDocument();
    expect(screen.getByText("Full width")).toBeInTheDocument();
  });

  it("nav_menu (NAV family) shows hover color + show-on-mobile toggle + the separate nav-row background and hover-animation controls", () => {
    render(<ElementSettingsPanel block={block("nav_menu")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByText("Hover color")).toBeInTheDocument();
    expect(screen.getByText("Show on mobile")).toBeInTheDocument();
    expect(screen.getByText("Header background color")).toBeInTheDocument();
    expect(screen.getByText("Nav row background color")).toBeInTheDocument();
    expect(screen.getByText("Enable hover animation")).toBeInTheDocument();
  });

  it("nav_menu 'Enable hover animation' defaults on and toggles the hoverAnimation setting", () => {
    const onUpdate = vi.fn();
    render(<ElementSettingsPanel block={block("nav_menu")} onUpdate={onUpdate} onToggleVisibility={noop} />);
    const row = screen.getByText("Enable hover animation").closest("div")!;
    const toggle = row.querySelector('[role="switch"]')!;
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenCalledWith("hoverAnimation", false);
  });

  it("product_price (PRICE family) shows the currency toggle", () => {
    render(<ElementSettingsPanel block={block("product_price")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByText("Show currency code")).toBeInTheDocument();
  });

  it("cart_icon (ICON family) shows visibility + color + size + position — the Part 5 minimum panel", () => {
    render(<ElementSettingsPanel block={block("cart_icon")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByLabelText("Position")).toBeInTheDocument();
  });

  it("cart_icon's visibility toggle calls onToggleVisibility, not onUpdate", () => {
    const onToggleVisibility = vi.fn();
    render(<ElementSettingsPanel block={block("cart_icon")} onUpdate={noop} onToggleVisibility={onToggleVisibility} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggleVisibility).toHaveBeenCalledOnce();
  });

  it("falls back to BlockSettingsForm's own content for a type outside all 6 families", () => {
    render(<ElementSettingsPanel block={block("footer_social")} onUpdate={noop} onToggleVisibility={noop} />);
    expect(screen.getByText(/Shows the icons for whichever social links/)).toBeInTheDocument();
    expect(screen.queryByText("Font size")).not.toBeInTheDocument();
  });

  it("calls onUpdate with the field key and new value when a text field changes", () => {
    const onUpdate = vi.fn();
    render(<ElementSettingsPanel block={block("heading", { text: "Hi" })} onUpdate={onUpdate} onToggleVisibility={noop} />);
    const input = screen.getByLabelText("Text content");
    fireEvent.change(input, { target: { value: "New heading" } });
    expect(onUpdate).toHaveBeenCalledWith("text", "New heading");
  });
});
