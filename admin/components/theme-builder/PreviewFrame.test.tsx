import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import PreviewFrame from "./PreviewFrame";
import { HEADER_CHROME_ID, type ThemeEditorState } from "@/lib/useThemeEditor";
import type { Shop, Theme, ThemeConfig, ThemeSectionType } from "@/lib/types";

// PreviewFrame builds the iframe src (and therefore the trusted message
// origin) from STOREFRONT_URL, which defaults to localhost:3002 with no
// env override — matching this test's dispatched MessageEvent origin below.
const shop = { id: 1, subdomain: "test-shop" } as Shop;

function fixtureConfig(): ThemeConfig {
  return {
    header: { blocks: [], settings: {} },
    footer: { blocks: [], settings: {} },
    sections: [
      { id: "sec-hero", type: "hero" as ThemeSectionType, visible: true, order: 0, settings: {}, blocks: [] },
    ],
    globalSettings: {} as ThemeConfig["globalSettings"],
  };
}

function fixtureEditor(overrides: Partial<ThemeEditorState> = {}): ThemeEditorState {
  return {
    theme: { id: 2, name: "Test Theme" } as Theme,
    config: fixtureConfig(),
    device: "desktop",
    selectNode: vi.fn(),
    reorderBlocks: vi.fn(),
    publishVersion: 0,
    settingsSearchQuery: "",
    setSettingsSearchQuery: vi.fn(),
    ...overrides,
  } as ThemeEditorState;
}

const PREVIEW_ORIGIN = "http://localhost:3002";

function postFromPreview(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: PREVIEW_ORIGIN }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreviewFrame — incoming postMessage routing", () => {
  it("routes element-selected to editor.selectNode with the element's own id", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    postFromPreview({ type: "element-selected", sectionId: "sec-hero", elementId: "blk-heading", elementType: "heading" });

    await waitFor(() => expect(editor.selectNode).toHaveBeenCalledWith("blk-heading"));
  });

  it("routes theme-section-selected (the pre-existing single-click channel) to selectNode with the section id", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    postFromPreview({ type: "theme-section-selected", sectionId: "sec-hero" });

    await waitFor(() => expect(editor.selectNode).toHaveBeenCalledWith("sec-hero"));
  });

  it("routes element-deselected to selectNode(null)", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    postFromPreview({ type: "element-deselected" });

    await waitFor(() => expect(editor.selectNode).toHaveBeenCalledWith(null));
  });

  it("routes element-moved to editor.reorderBlocks with a resolved section container and the given order", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    postFromPreview({ type: "element-moved", sectionId: "sec-hero", elementId: "blk-cta", orderedIds: ["blk-subheading", "blk-cta"] });

    await waitFor(() =>
      expect(editor.reorderBlocks).toHaveBeenCalledWith(
        { kind: "section", sectionId: "sec-hero", sectionType: "hero" },
        null,
        ["blk-subheading", "blk-cta"],
      ),
    );
  });

  it("resolves the header/footer chrome sentinel container for a header-level element-moved message", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    postFromPreview({ type: "element-moved", sectionId: HEADER_CHROME_ID, elementId: "blk-logo", orderedIds: ["blk-logo"] });

    await waitFor(() =>
      expect(editor.reorderBlocks).toHaveBeenCalledWith({ kind: "header" }, null, ["blk-logo"]),
    );
  });

  it("ignores a message from an untrusted origin — no editor state changes", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "element-selected", sectionId: "sec-hero", elementId: "blk-heading", elementType: "heading" },
        origin: "https://evil.example.com",
      }),
    );

    // No waitFor to assert a negative — give any (incorrect) async handling
    // a tick to run before checking it never fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(editor.selectNode).not.toHaveBeenCalled();
  });
});

describe("PreviewFrame — settings search box (moved into the toolbar, next to Preview page)", () => {
  it("renders the search input in the same toolbar row as the Preview page selector", () => {
    const editor = fixtureEditor();
    const { getByPlaceholderText, getByText } = render(<PreviewFrame editor={editor} shop={shop} />);

    const toolbarRow = getByText("Preview page").closest("div");
    const input = getByPlaceholderText("Search settings...");
    expect(toolbarRow).toContainElement(input);
  });

  it("typing in the search box updates editor.settingsSearchQuery", async () => {
    const editor = fixtureEditor();
    const { getByPlaceholderText } = render(<PreviewFrame editor={editor} shop={shop} />);

    const input = getByPlaceholderText("Search settings...");
    fireEvent.change(input, { target: { value: "colo" } });

    await waitFor(() => expect(editor.setSettingsSearchQuery).toHaveBeenCalledWith("colo"));
  });
});
