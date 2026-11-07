import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CollectionPageSettings from "./CollectionPageSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

vi.mock("../RichTextBlockEditor", () => ({ default: () => null }));

function makeEditor(collectionPage: Record<string, unknown> = {}): ThemeEditorState {
  return {
    config: {
      globalSettings: {
        collectionPage: { textAboveProducts: "", textBelowProducts: "", fontFamily: "", fontSize: 15, textColor: "", loadMoreStyle: "infinite", columns: 3, ...collectionPage },
        colorSchemes: [],
      },
    },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("CollectionPageSettings: banner height and no-image title", () => {
  it("shows the current 220px as the placeholder when nothing was set", () => {
    render(<CollectionPageSettings editor={makeEditor()} />);
    const [desktop, mobile] = screen.getAllByPlaceholderText("220");
    expect(desktop).toHaveValue(null);
    expect(mobile).toHaveValue(null);
  });

  it("typing a desktop height writes bannerHeight, clamped to 120 to 900", () => {
    const editor = makeEditor();
    render(<CollectionPageSettings editor={editor} />);
    const [desktop] = screen.getAllByPlaceholderText("220");
    fireEvent.change(desktop, { target: { value: "5000" } });
    expect(editor.updateGlobalSettingsCategory).toHaveBeenLastCalledWith("collectionPage", { bannerHeight: 900, bannerMobileHeight: undefined });
    fireEvent.change(desktop, { target: { value: "10" } });
    expect(editor.updateGlobalSettingsCategory).toHaveBeenLastCalledWith("collectionPage", { bannerHeight: 120, bannerMobileHeight: undefined });
  });

  it("the mobile slider writes bannerMobileHeight and keeps the desktop value", () => {
    const editor = makeEditor({ bannerHeight: 400 });
    render(<CollectionPageSettings editor={editor} />);
    fireEvent.change(screen.getAllByRole("slider")[1], { target: { value: "260" } });
    expect(editor.updateGlobalSettingsCategory).toHaveBeenLastCalledWith("collectionPage", { bannerHeight: 400, bannerMobileHeight: 260 });
  });

  it("clearing the box goes back to unset (the current height)", () => {
    const editor = makeEditor({ bannerHeight: 400 });
    render(<CollectionPageSettings editor={editor} />);
    fireEvent.change(screen.getAllByPlaceholderText("220")[0], { target: { value: "" } });
    expect(editor.updateGlobalSettingsCategory).toHaveBeenLastCalledWith("collectionPage", { bannerHeight: undefined, bannerMobileHeight: undefined });
  });

  it("the no-image title block has alignment and spacing controls", () => {
    const editor = makeEditor({ noBannerTitleAlign: "center", noBannerTitleSpacingTop: 10 });
    render(<CollectionPageSettings editor={editor} />);
    expect(screen.getByText("Page title when there is no banner image")).toBeInTheDocument();
    expect(screen.getByLabelText("Space above (px)")).toHaveValue(10);
    fireEvent.change(screen.getByLabelText("Space below (px)"), { target: { value: "500" } });
    expect(editor.updateGlobalSettingsCategory).toHaveBeenLastCalledWith("collectionPage", { noBannerTitleSpacingBottom: 200 });
  });
});
