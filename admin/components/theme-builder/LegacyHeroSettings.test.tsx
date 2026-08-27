import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LegacyHeroSettings from "./LegacyHeroSettings";
import { ToastProvider } from "@/components/ui/Toast";
import type { ThemeEditorState } from "@/lib/useThemeEditor";
import type { ThemeSettings } from "@/lib/types";

// LegacyHeroSettings calls useLegacyTheme() directly (its own independent
// fetch, same as every other legacy sub-section — see that hook's own doc
// comment), so it needs its own getTheme()/updateTheme() mock rather than
// reading from the editor fixture the way LayoutSettings.test.tsx does.
vi.mock("@/lib/api", () => ({
  getTheme: vi.fn(() =>
    Promise.resolve({
      shopId: 1,
      heroText: "Fresh flowers, delivered same-day",
      images: [],
    } as unknown as ThemeSettings),
  ),
  updateTheme: vi.fn(),
}));

function fixtureEditor(overrides: Partial<ThemeEditorState> = {}): ThemeEditorState {
  return {
    theme: { id: 1, isPublished: false } as ThemeEditorState["theme"],
    legacyTheme: { homepageLayout: "classic" } as ThemeSettings,
    setEditorMode: vi.fn(),
    setLayoutCategory: vi.fn(),
    ...overrides,
  } as ThemeEditorState;
}

describe("LegacyHeroSettings — published sections theme", () => {
  it("hides the real fields and explains the Hero block/Sections tab own the live homepage instead", async () => {
    const editor = fixtureEditor({ theme: { id: 1, isPublished: true } as ThemeEditorState["theme"] });
    render(<LegacyHeroSettings editor={editor} />);

    await waitFor(() => expect(screen.getByText("Classic homepage banner")).toBeInTheDocument());
    expect(screen.getByText(/Sections builder/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Hero / banner text")).not.toBeInTheDocument();
  });
});

describe("LegacyHeroSettings — unpublished, but the current homepage layout doesn't use it", () => {
  it("hides the real fields and links to Layout mode's Homepage layout setting", async () => {
    const editor = fixtureEditor({ legacyTheme: { homepageLayout: "featured_grid" } as ThemeSettings });
    render(<LegacyHeroSettings editor={editor} />);

    await waitFor(() => expect(screen.getByText(/doesn't use this setting/i)).toBeInTheDocument());
    expect(screen.queryByLabelText("Hero / banner text")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Change it in Layout mode/i }));
    expect(editor.setEditorMode).toHaveBeenCalledWith("layout");
    expect(editor.setLayoutCategory).toHaveBeenCalledWith("Homepage layout");
  });
});

describe("LegacyHeroSettings — unpublished, layout is Classic/Slideshow", () => {
  it("shows the real, editable banner text/image fields, seeded from the legacy theme row", async () => {
    const editor = fixtureEditor();
    render(
      <ToastProvider>
        <LegacyHeroSettings editor={editor} />
      </ToastProvider>,
    );

    // findByLabelText only waits for the element to exist, not for the
    // seed-from-fetched-theme effect (a separate render pass, commits after
    // the one that first stops returning null) to have run yet — assert via
    // waitFor on the actual value to avoid a real, not just theoretical,
    // race between the two.
    await waitFor(async () =>
      expect(await screen.findByLabelText("Hero / banner text")).toHaveValue("Fresh flowers, delivered same-day"),
    );
  });

  it("also shows the fields for the Slideshow layout, not just Classic", async () => {
    const editor = fixtureEditor({ legacyTheme: { homepageLayout: "slideshow" } as ThemeSettings });
    render(
      <ToastProvider>
        <LegacyHeroSettings editor={editor} />
      </ToastProvider>,
    );

    await screen.findByLabelText("Hero / banner text");
  });
});
