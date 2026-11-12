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
    builderContext: { sectionsMode: false, sectionTypesPresent: new Set() },
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

  it("in Sections mode shows only the preset picker: no legacy toggle, grid controls or blurred notice", () => {
    const editor = fixtureEditor({
      builderContext: { sectionsMode: true, sectionTypesPresent: new Set() },
      legacyTheme: fixtureLegacyTheme({ homeTabMode: "collections" }),
    });
    render(<HomeTabSetting editor={editor} />);

    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.queryByText("Columns")).not.toBeInTheDocument();
    expect(screen.queryByText("Show collection title")).not.toBeInTheDocument();
    expect(screen.queryByText(/uses the Sections builder/i)).not.toBeInTheDocument();
  });
});
