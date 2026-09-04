import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HeaderSettings from "./HeaderSettings";
import type { ThemeBlock } from "@/lib/types";

// LegacyHeaderSettings pulls in useLegacyTheme (its own network fetch) —
// irrelevant to this file, stubbed the same way a complex unrelated child
// component gets mocked elsewhere.
vi.mock("../LegacyHeaderSettings", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

const BLOCKS: ThemeBlock[] = [
  { id: "hdr-logo", type: "logo", visible: true, order: 0, settings: {} },
  { id: "hdr-nav-menu", type: "nav_menu", visible: true, order: 1, settings: {} },
];

describe("HeaderSettings — menu bar background", () => {
  it("renders a Menu bar background color control separate from Header background", () => {
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={vi.fn()} onApplyPreset={vi.fn()} />);
    expect(screen.getByText("Menu bar background")).toBeInTheDocument();
    expect(screen.getByText(/falls back to the header background above/i)).toBeInTheDocument();
  });

  it("picking a hex value in the Menu bar background swatch calls onUpdate with that key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={onUpdate} onApplyPreset={vi.fn()} />);

    const row = screen.getByText("Menu bar background").closest("div")!;
    await user.click(within(row).getByRole("button", { name: /pick color/i }));

    const hexInput = screen.getByLabelText("Hex color value");
    await user.clear(hexInput);
    await user.type(hexInput, "#123456");
    await user.tab();

    expect(onUpdate).toHaveBeenCalledWith("menuBarBackground", "#123456");
  });
});

describe("HeaderSettings — header rows (Phase 3)", () => {
  it("shows the single-row hint when settings.rows is absent", () => {
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={vi.fn()} onApplyPreset={vi.fn()} />);
    expect(screen.getByText(/the header renders as one row/i)).toBeInTheDocument();
  });

  it("'Add row' appends a row via onUpdate('rows', [...])", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeaderSettings settings={{ rows: [] }} blocks={BLOCKS} onUpdate={onUpdate} onApplyPreset={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add row/i }));
    expect(onUpdate).toHaveBeenCalledWith(
      "rows",
      expect.arrayContaining([expect.objectContaining({ blockIds: [], align: "left" })]),
    );
  });

  it("renders an existing row's assigned block as a labelled chip", () => {
    render(
      <HeaderSettings
        settings={{ rows: [{ id: "r1", blockIds: ["hdr-logo"], align: "center" }] }}
        blocks={BLOCKS}
        onUpdate={vi.fn()}
        onApplyPreset={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Row alignment")).toHaveValue("center");
    expect(screen.getByText("Logo")).toBeInTheDocument();
    // The nav block isn't assigned, so it's offered in the add-block picker.
    expect(screen.getByRole("option", { name: "Menu" })).toBeInTheDocument();
  });
});

describe("HeaderSettings — layout presets and new settings (C1)", () => {
  it("renders one preset card per HEADER_PRESETS entry and calls onApplyPreset on click", async () => {
    const user = userEvent.setup();
    const onApplyPreset = vi.fn();
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={vi.fn()} onApplyPreset={onApplyPreset} />);
    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Colored band")).toBeInTheDocument();
    await user.click(screen.getByText("Centered"));
    expect(onApplyPreset).toHaveBeenCalledWith("centered");
  });

  it("defaults height/contentWidth/separator/mobileNav selects to today's implicit values", () => {
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={vi.fn()} onApplyPreset={vi.fn()} />);
    expect(screen.getByLabelText("Height")).toHaveValue("default");
    expect(screen.getByLabelText("Content width")).toHaveValue("contained");
    expect(screen.getByLabelText("Separator")).toHaveValue("line");
    expect(screen.getByLabelText("Mobile nav")).toHaveValue("scroll");
  });

  it("calls onUpdate with the picked mobileNav value", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeaderSettings settings={{}} blocks={BLOCKS} onUpdate={onUpdate} onApplyPreset={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Mobile nav"), "drawer");
    expect(onUpdate).toHaveBeenCalledWith("mobileNav", "drawer");
  });
});
