import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BadgesSettings from "./BadgesSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

vi.mock("../SchemePicker", () => ({ default: () => <div data-testid="scheme-picker" /> }));

function makeEditor(badges: Record<string, unknown>): ThemeEditorState {
  return {
    config: {
      globalSettings: {
        badges: { position: "top_right", cornerRadius: 4, saleSchemeId: "s1", soldOutSchemeId: "s1", font: "body", case: "uppercase", ...badges },
        colorSchemes: [{ id: "s1", name: "Light" }],
      },
    },
    updateGlobalSettingsCategory: vi.fn(),
    setEditorMode: vi.fn(),
    setThemeSettingsCategory: vi.fn(),
    addColorScheme: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("BadgesSettings — shape (§8.13.C item 1)", () => {
  it("defaults the Shape select to Rectangle when style is unset", () => {
    render(<BadgesSettings editor={makeEditor({})} />);
    expect((screen.getByLabelText("Shape") as HTMLSelectElement).value).toBe("rectangle");
  });

  it("reflects an existing style value", () => {
    render(<BadgesSettings editor={makeEditor({ style: "ribbon" })} />);
    expect((screen.getByLabelText("Shape") as HTMLSelectElement).value).toBe("ribbon");
  });

  it("picking Tag writes { style: 'tag' }", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({});
    render(<BadgesSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Shape"), "tag");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("badges", { style: "tag" });
  });

  it("picking Rectangle writes { style: undefined } (the true no-op)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ style: "circle" });
    render(<BadgesSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Shape"), "rectangle");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("badges", { style: undefined });
  });
});

describe("BadgesSettings — entranceAnimation (§8.13.C item 5)", () => {
  it("renders the Pop-in animation toggle, off by default", () => {
    render(<BadgesSettings editor={makeEditor({})} />);
    const row = screen.getByText("Pop-in animation").closest("div")!;
    expect(row.querySelector('[role="switch"]')).not.toBeChecked();
  });

  it("toggling it on writes { entranceAnimation: true }", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({});
    render(<BadgesSettings editor={editor} />);
    const row = screen.getByText("Pop-in animation").closest("div")!;
    await user.click(row.querySelector('[role="switch"]')!);
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("badges", { entranceAnimation: true });
  });

  it("toggling it off writes { entranceAnimation: undefined }", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ entranceAnimation: true });
    render(<BadgesSettings editor={editor} />);
    const row = screen.getByText("Pop-in animation").closest("div")!;
    await user.click(row.querySelector('[role="switch"]')!);
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("badges", { entranceAnimation: undefined });
  });
});
