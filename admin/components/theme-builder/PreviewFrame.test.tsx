import { describe, expect, it, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import PreviewFrame, { previewGeometry } from "./PreviewFrame";
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

// Session-cookie migration (security audit finding #1), phase 2 — the
// preview iframe's src (and therefore previewOrigin, and therefore the
// window 'message' listener that depends on it — see PreviewFrame.tsx's
// own registration effect) is now resolved async (a getThemePreviewToken()
// fetch has to settle first, see that file's own comment), where it used to
// be synchronous. `waitFor(iframe in DOM)` can observe the iframe's DOM
// commit before React has actually run the listener-registration effect for
// that same render — a single dispatchEvent sent right after is a real,
// not merely theoretical, race: an event dispatched before a listener
// exists is simply lost, never queued. Re-dispatching inside waitFor's own
// retry loop until the assertion passes sidesteps the race without needing
// to assert on a React internal.
async function postFromPreviewUntil(data: unknown, assertion: () => void) {
  await waitFor(() => {
    postFromPreview(data);
    assertion();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreviewFrame — incoming postMessage routing", () => {
  it("routes element-selected to editor.selectNode with the element's own id", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    await postFromPreviewUntil(
      { type: "element-selected", sectionId: "sec-hero", elementId: "blk-heading", elementType: "heading" },
      () => expect(editor.selectNode).toHaveBeenCalledWith("blk-heading"),
    );
  });

  it("routes theme-section-selected (the pre-existing single-click channel) to selectNode with the section id", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    await postFromPreviewUntil(
      { type: "theme-section-selected", sectionId: "sec-hero" },
      () => expect(editor.selectNode).toHaveBeenCalledWith("sec-hero"),
    );
  });

  it("routes element-deselected to selectNode(null) while a block is selected", async () => {
    const editor = fixtureEditor({ selection: { kind: "block" } as ThemeEditorState["selection"] });
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    await postFromPreviewUntil(
      { type: "element-deselected" },
      () => expect(editor.selectNode).toHaveBeenCalledWith(null),
    );
  });

  it("ignores element-deselected while a section is open (the preview sends it every time it mounts)", async () => {
    const config = fixtureConfig();
    const editor = fixtureEditor({ config, selection: { kind: "section", section: config.sections[0] } });
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());
    // Prove the listener is live first, then send the deselect.
    await postFromPreviewUntil({ type: "theme-section-selected", sectionId: "sec-hero" }, () =>
      expect(editor.selectNode).toHaveBeenCalledWith("sec-hero"),
    );
    postFromPreview({ type: "element-deselected" });
    await new Promise((r) => setTimeout(r, 20));
    expect(editor.selectNode).not.toHaveBeenCalledWith(null);
  });

  it("routes element-moved to editor.reorderBlocks with a resolved section container and the given order", async () => {
    const editor = fixtureEditor();
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());

    await postFromPreviewUntil(
      { type: "element-moved", sectionId: "sec-hero", elementId: "blk-cta", orderedIds: ["blk-subheading", "blk-cta"] },
      () =>
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

    await postFromPreviewUntil(
      { type: "element-moved", sectionId: HEADER_CHROME_ID, elementId: "blk-logo", orderedIds: ["blk-logo"] },
      () => expect(editor.reorderBlocks).toHaveBeenCalledWith({ kind: "header" }, null, ["blk-logo"]),
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

describe("PreviewFrame — the stage", () => {
  it("no longer carries the settings search or its own page toolbar (both moved to the top bar)", () => {
    const editor = fixtureEditor();
    const { queryByPlaceholderText, queryByText } = render(<PreviewFrame editor={editor} shop={shop} />);
    expect(queryByPlaceholderText("Search settings...")).not.toBeInTheDocument();
    expect(queryByText("Preview page")).not.toBeInTheDocument();
  });

  it("has a zoom pill: minus, percentage, plus and Fit", () => {
    const editor = fixtureEditor();
    const { getByRole, getByText } = render(<PreviewFrame editor={editor} shop={shop} />);
    const pill = getByRole("group", { name: "Preview zoom" });
    expect(pill).toContainElement(getByRole("button", { name: "Zoom out" }));
    expect(pill).toContainElement(getByRole("button", { name: "Zoom in" }));
    expect(pill).toContainElement(getByText("Fit"));
    expect(pill).toHaveTextContent("100%");
  });
});

describe("previewGeometry", () => {
  const stage = { width: 1032, height: 832 };

  it("desktop at Fit fills the stage at 100% (the card height is the stage, the iframe scrolls itself)", () => {
    const g = previewGeometry(stage, "desktop", "fit");
    expect(g.scale).toBe(1);
    expect(g.cardWidth).toBe(1000);
    expect(g.cardHeight).toBe(800);
    expect(g.frameHeight).toBe(800);
  });

  it("a device wider than the stage is scaled down to fit at Fit", () => {
    const g = previewGeometry({ width: 532, height: 832 }, "tablet", "fit");
    expect(g.scale).toBeCloseTo(500 / 768);
    expect(g.frameWidth).toBe(768);
    expect(g.cardWidth).toBeCloseTo(500);
    expect(g.frameHeight).toBeCloseTo(800 / (500 / 768));
  });

  it("an explicit zoom scales the frame and keeps the card exactly the scaled size", () => {
    const g = previewGeometry(stage, "mobile", 50);
    expect(g.scale).toBe(0.5);
    expect(g.frameWidth).toBe(390);
    expect(g.cardWidth).toBe(195);
    expect(g.frameHeight).toBe(1600);
  });
});

describe("PreviewFrame — section outline protocol", () => {
  it("answers the preview's selection request with the selected section's id, name and the builder accent", async () => {
    const config = fixtureConfig();
    const editor = fixtureEditor({ config, selection: { kind: "section", section: config.sections[0] } });
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());
    const frameWindow = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});

    await waitFor(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "preview-selection-request" }, origin: PREVIEW_ORIGIN, source: frameWindow }));
      expect(post).toHaveBeenCalledWith(
        { type: "preview-select-section", sectionId: "sec-hero", label: "Hero", color: "#0f766e" },
        PREVIEW_ORIGIN,
      );
    });
  });

  it("answers with a clear when no section is selected, and ignores a request from another origin", async () => {
    const editor = fixtureEditor({ selection: { kind: "block" } as ThemeEditorState["selection"] });
    render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());
    const frameWindow = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});

    window.dispatchEvent(new MessageEvent("message", { data: { type: "preview-selection-request" }, origin: "https://evil.example.com", source: frameWindow }));
    await waitFor(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "preview-selection-request" }, origin: PREVIEW_ORIGIN, source: frameWindow }));
      expect(post).toHaveBeenCalledWith({ type: "preview-select-section", sectionId: null }, PREVIEW_ORIGIN);
    });
    expect(post.mock.calls.every((c) => (c[1] as unknown) === PREVIEW_ORIGIN)).toBe(true);
  });

  it("no longer draws its own name chip on the card (the preview draws it on the section)", async () => {
    const config = fixtureConfig();
    const editor = fixtureEditor({ config, selection: { kind: "section", section: config.sections[0] } });
    const { queryByTestId } = render(<PreviewFrame editor={editor} shop={shop} />);
    await waitFor(() => expect(document.querySelector("iframe")).toBeInTheDocument());
    expect(queryByTestId("preview-selection-chip")).toBeNull();
  });
});
