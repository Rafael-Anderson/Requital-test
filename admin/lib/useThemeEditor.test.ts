import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useThemeEditor } from "./useThemeEditor";
import type { Theme, ThemeConfig, ThemeSettings } from "./types";

const getThemeBuilder = vi.fn();
const updateThemeDraft = vi.fn();
const publishTheme = vi.fn();
const getTheme = vi.fn();
const updateTheme = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// A stable function reference, not a fresh vi.fn() per call — useThemeEditor's
// `load` is a useCallback keyed on this value (see its own "Layout mode"
// comment for why); an unstable mock here made `load`'s identity change on
// every render, re-firing its effect and racing any awaited assertion with
// a fresh, un-reordered fixture fetch that silently clobbered state.
const toastMock = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => toastMock,
}));

vi.mock("@/lib/api", () => ({
  getThemeBuilder: (...args: unknown[]) => getThemeBuilder(...args),
  updateThemeDraft: (...args: unknown[]) => updateThemeDraft(...args),
  publishTheme: (...args: unknown[]) => publishTheme(...args),
  // Layout mode's legacy theme row — a separate hook effect/action from the
  // theme.config fetch above (see useThemeEditor.ts's own legacyTheme
  // comment). Mocked here purely so that effect doesn't throw on an
  // undefined import; not the focus of this file's own tests.
  getTheme: (...args: unknown[]) => getTheme(...args),
  updateTheme: (...args: unknown[]) => updateTheme(...args),
}));

function fixtureLegacyTheme(): ThemeSettings {
  return { shopId: 1 } as ThemeSettings;
}

function fixtureConfig(): ThemeConfig {
  return {
    header: { blocks: [], settings: {} },
    footer: { blocks: [], settings: {} },
    sections: [
      {
        id: "sec-hero",
        type: "hero",
        visible: true,
        order: 0,
        settings: {},
        blocks: [
          { id: "blk-heading", type: "heading", visible: true, order: 0, settings: { text: "Welcome" } },
          { id: "blk-subheading", type: "subheading", visible: true, order: 1, settings: { text: "" } },
        ],
      },
    ],
    // Real shape has many more globalSettings categories — only what the
    // hook itself reads/passes through untouched is needed for this test.
    globalSettings: {} as ThemeConfig["globalSettings"],
  };
}

function fixtureTheme(config: ThemeConfig): Theme {
  return {
    id: 1,
    name: "Test Theme",
    isPublished: false,
    config,
    updatedAt: new Date().toISOString(),
  } as Theme;
}

beforeEach(() => {
  getThemeBuilder.mockReset();
  updateThemeDraft.mockReset();
  publishTheme.mockReset();
  getTheme.mockReset();
  updateTheme.mockReset();
  toastMock.mockReset();
  getThemeBuilder.mockResolvedValue(fixtureTheme(fixtureConfig()));
  // Exercised by the unmount-time "save on close" cleanup effect even when
  // a test never calls save() itself — needs a real resolved Promise, not
  // vitest's default undefined return, since that effect always calls
  // .catch() on the result.
  updateThemeDraft.mockResolvedValue(fixtureTheme(fixtureConfig()));
  getTheme.mockResolvedValue(fixtureLegacyTheme());
  updateTheme.mockResolvedValue(fixtureLegacyTheme());
});

describe("useThemeEditor — updateBlockSetting propagation", () => {
  it("writes a new setting onto the correct block within its section's block tree, leaving siblings untouched", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.updateBlockSetting(
        { kind: "section", sectionId: "sec-hero", sectionType: "hero" },
        "blk-heading",
        "text",
        "Updated heading",
      );
    });

    const section = result.current.config!.sections.find((s) => s.id === "sec-hero")!;
    const heading = section.blocks.find((b) => b.id === "blk-heading")!;
    const subheading = section.blocks.find((b) => b.id === "blk-subheading")!;
    expect(heading.settings.text).toBe("Updated heading");
    expect(subheading.settings.text).toBe(""); // untouched sibling
    expect(result.current.dirty).toBe(true);
  });

  it("adding a new style field to a block preserves its existing content field", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.updateBlockSetting(
        { kind: "section", sectionId: "sec-hero", sectionType: "hero" },
        "blk-heading",
        "fontSize",
        32,
      );
    });

    const heading = result.current
      .config!.sections.find((s) => s.id === "sec-hero")!
      .blocks.find((b) => b.id === "blk-heading")!;
    expect(heading.settings.fontSize).toBe(32);
    expect(heading.settings.text).toBe("Welcome");
  });

  it("selecting a block by id resolves the same selection whether reached via the tree or via the preview's double-click channel", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => result.current.selectNode("blk-heading"));

    expect(result.current.selection?.kind).toBe("block");
    if (result.current.selection?.kind === "block") {
      expect(result.current.selection.block.id).toBe("blk-heading");
      expect(result.current.selection.container).toEqual({
        kind: "section",
        sectionId: "sec-hero",
        sectionType: "hero",
      });
    }
  });
});

describe("useThemeEditor — Home tab 'Templates' preset", () => {
  it("applyHomepagePreset replaces the whole sections list with the preset's arrangement, in order", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.applyHomepagePreset("minimal");
    });

    expect(result.current.config!.sections.map((s) => s.type)).toEqual(["hero", "featured_collections"]);
    expect(result.current.config!.sections.map((s) => s.order)).toEqual([0, 1]);
  });

  it("saves immediately, same as a reorder, rather than waiting for autosave", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.applyHomepagePreset("default");
    });

    await waitFor(() => expect(updateThemeDraft).toHaveBeenCalledTimes(1));
  });

  it("ignores an unknown preset key rather than clearing the existing sections", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    const before = result.current.config!.sections;

    act(() => {
      result.current.applyHomepagePreset("not-a-real-preset");
    });

    expect(result.current.config!.sections).toBe(before);
  });
});

describe("useThemeEditor — drag-and-drop reorder persists immediately on drop", () => {
  it("reorderSections saves right away instead of waiting for autosave/beforeunload", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.reorderSections(["sec-hero"]);
    });

    await waitFor(() => expect(updateThemeDraft).toHaveBeenCalledTimes(1));
    expect(updateThemeDraft).toHaveBeenCalledWith(1, { config: result.current.config });
  });

  it("reorderBlocks (both the sidebar tree and the in-preview drag route through this) saves right away", async () => {
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    act(() => {
      result.current.reorderBlocks(
        { kind: "section", sectionId: "sec-hero", sectionType: "hero" },
        null,
        ["blk-subheading", "blk-heading"],
      );
    });

    await waitFor(() => expect(updateThemeDraft).toHaveBeenCalledTimes(1));
    const section = result.current.config!.sections.find((s) => s.id === "sec-hero")!;
    expect(section.blocks.map((b) => b.id)).toEqual(["blk-subheading", "blk-heading"]);
  });
});

describe("useThemeEditor — legacyTheme (Layout mode)", () => {
  it("loads the legacy theme row on mount, independently of the theme.config fetch", async () => {
    getTheme.mockResolvedValue({ shopId: 1, buttonRadius: "sharp", buttonFill: "outline" } as ThemeSettings);
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.legacyTheme).not.toBeNull());
    expect(result.current.legacyTheme?.buttonRadius).toBe("sharp");
    expect(getTheme).toHaveBeenCalled();
  });

  it("updateLegacyTheme PATCHes and replaces legacyTheme with the server's response, the one shared instance every Layout category component now reads/writes through", async () => {
    updateTheme.mockResolvedValue({ shopId: 1, buttonRadius: "pill", buttonFill: "solid" } as ThemeSettings);
    const { result } = renderHook(() => useThemeEditor(1));
    await waitFor(() => expect(result.current.legacyTheme).not.toBeNull());

    act(() => {
      void result.current.updateLegacyTheme({ buttonRadius: "pill" });
    });

    await waitFor(() => expect(result.current.legacyTheme?.buttonRadius).toBe("pill"));
    expect(updateTheme).toHaveBeenCalledWith({ buttonRadius: "pill" });
  });
});
