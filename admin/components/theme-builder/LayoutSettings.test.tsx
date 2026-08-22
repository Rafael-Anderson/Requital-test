import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeTabSetting } from "./LayoutSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";
import type { ThemeSettings } from "@/lib/types";

function fixtureLegacyTheme(overrides: Partial<ThemeSettings> = {}): ThemeSettings {
  return {
    shopId: 1,
    homeTabMode: "templates",
    collectionsGridColumns: 3,
    collectionsGridGap: "md",
    collectionsGridShowTitle: true,
    collectionsGridImageAspectRatio: "portrait",
    ...overrides,
  } as ThemeSettings;
}

function fixtureEditor(overrides: Partial<ThemeEditorState> = {}): ThemeEditorState {
  return {
    theme: { id: 1, isPublished: false } as ThemeEditorState["theme"],
    legacyTheme: fixtureLegacyTheme(),
    updateLegacyTheme: vi.fn(),
    applyHomepagePreset: vi.fn(),
    ...overrides,
  } as ThemeEditorState;
}

describe("HomeTabSetting — Templates mode", () => {
  it("shows the Default/Minimal/Featured preset thumbnails, not an empty panel", () => {
    const editor = fixtureEditor();
    render(<HomeTabSetting editor={editor} />);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });

  it("clicking a preset calls applyHomepagePreset with its key", async () => {
    const user = userEvent.setup();
    const editor = fixtureEditor();
    render(<HomeTabSetting editor={editor} />);

    await user.click(screen.getByText("Minimal"));

    expect(editor.applyHomepagePreset).toHaveBeenCalledWith("minimal");
  });
});

describe("HomeTabSetting — Collections grid mode", () => {
  it("shows real columns/gap/aspect-ratio/title controls, not an empty panel", () => {
    const editor = fixtureEditor({ legacyTheme: fixtureLegacyTheme({ homeTabMode: "collections" }) });
    render(<HomeTabSetting editor={editor} />);

    expect(screen.getByText("Columns")).toBeInTheDocument();
    expect(screen.getByText("Gap")).toBeInTheDocument();
    expect(screen.getByText("Image aspect ratio")).toBeInTheDocument();
    expect(screen.getByText("Show collection title")).toBeInTheDocument();
  });

  it("picking a column count calls updateLegacyTheme with a real number, not the raw string", async () => {
    const user = userEvent.setup();
    const editor = fixtureEditor({ legacyTheme: fixtureLegacyTheme({ homeTabMode: "collections" }) });
    render(<HomeTabSetting editor={editor} />);

    const columnsRow = screen.getByText("Columns").closest("div")!;
    await user.click(within(columnsRow).getByText("4"));

    expect(editor.updateLegacyTheme).toHaveBeenCalledWith({ collectionsGridColumns: 4 });
  });

  it("toggling Show collection title calls updateLegacyTheme with the flipped boolean", async () => {
    const user = userEvent.setup();
    const editor = fixtureEditor({ legacyTheme: fixtureLegacyTheme({ homeTabMode: "collections", collectionsGridShowTitle: true }) });
    render(<HomeTabSetting editor={editor} />);

    await user.click(screen.getByRole("switch"));

    expect(editor.updateLegacyTheme).toHaveBeenCalledWith({ collectionsGridShowTitle: false });
  });

  it("grays the controls out once the shop has a published sections theme, same as the mode toggle above it", () => {
    const editor = fixtureEditor({
      theme: { id: 1, isPublished: true } as ThemeEditorState["theme"],
      legacyTheme: fixtureLegacyTheme({ homeTabMode: "collections" }),
    });
    render(<HomeTabSetting editor={editor} />);

    expect(screen.getAllByText(/manage your homepage layout in the Sections tab/i).length).toBeGreaterThan(0);
  });
});
