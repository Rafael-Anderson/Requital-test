import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ThemeBuilderPage from "@/app/theme/[themeId]/builder/page";
import type { Shop, Theme, ThemeConfig } from "@/lib/types";

// The whole builder shell, with the real useThemeEditor: one left panel (no right-hand settings
// rail), tabs with text labels, and the drill-in that replaces the panel's content.

vi.mock("next/navigation", () => ({
  useParams: () => ({ themeId: "7" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const toastMock = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastMock }));

// The preview iframe is covered by PreviewFrame.test.tsx; here it is a stand-in.
vi.mock("@/components/theme-builder/PreviewFrame", () => ({
  default: () => <div data-testid="preview-stub" />,
  PreviewPageSelector: () => <button type="button">Page: Home</button>,
}));

function fixtureConfig(): ThemeConfig {
  return {
    header: { settings: {}, blocks: [{ id: "blk-logo", type: "logo", visible: true, order: 0, settings: {} }] },
    footer: { settings: {}, blocks: [] },
    sections: [
      { id: "sec-hero", type: "hero", visible: true, order: 0, settings: { contentPosition: "center-center" }, blocks: [] },
      { id: "sec-news", type: "newsletter", visible: true, order: 1, settings: {}, blocks: [] },
    ],
    globalSettings: { colorSchemes: [] } as unknown as ThemeConfig["globalSettings"],
  };
}

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:3000",
  getStaffCsrfToken: () => "",
  getThemeBuilder: () =>
    Promise.resolve({ id: 7, name: "Spring", isPublished: true, publishedAt: null, updatedAt: "", config: fixtureConfig() } as Theme),
  listThemes: () => Promise.resolve([{ id: 7, name: "Spring", isPublished: true, publishedAt: null, updatedAt: "" }]),
  getShop: () => Promise.resolve({ id: 1, name: "Bloom", displayName: "Bloom Atelier", subdomain: "bloom" } as Shop),
  getTheme: () => Promise.resolve({ shopId: 1 }),
  updateTheme: vi.fn(),
  updateThemeDraft: vi.fn(() => Promise.resolve({ id: 7, name: "Spring", isPublished: true, config: fixtureConfig() })),
  publishTheme: vi.fn(),
  listMenuItems: () => Promise.resolve([]),
  listCollections: () => Promise.resolve([]),
  listProducts: () => Promise.resolve([]),
  listBrands: () => Promise.resolve([]),
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/theme/7/builder");
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderBuilder() {
  render(<ThemeBuilderPage />);
  await screen.findByRole("tab", { name: "Sections" });
}

describe("theme builder shell", () => {
  it("has ONE settings surface: opening a section renders its settings once, inside the left panel (no right rail)", async () => {
    await renderBuilder();
    const panel = screen.getByTestId("builder-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "Hero" }));

    const drill = await screen.findByTestId("builder-drill-in");
    expect(panel).toContainElement(drill);
    // The Hero form is rendered exactly once in the document, and it is in the panel.
    const fields = screen.getAllByText("Content position");
    expect(fields).toHaveLength(1);
    expect(panel).toContainElement(fields[0]);
    // Nothing besides the panel and the preview sits in the body row.
    expect(screen.queryByText("No selection")).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a section or block on the left/)).not.toBeInTheDocument();
  });

  it("the tabs are text-labelled and the panel is a drill-in: Back returns to the tree", async () => {
    await renderBuilder();
    for (const name of ["Sections", "Design", "Settings"]) expect(screen.getByRole("tab", { name })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Newsletter Signup" }));
    const drill = await screen.findByTestId("builder-drill-in");
    expect(within(drill).getByRole("heading", { name: "Newsletter Signup" })).toBeInTheDocument();
    expect(within(drill).getByText("Template · Section 2 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("builder-list-sections")).not.toBeVisible();
    expect(window.location.search).toContain("node=sec-news");

    fireEvent.click(within(drill).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByTestId("builder-drill-in")).not.toBeInTheDocument());
    expect(screen.getByTestId("builder-list-sections")).toBeVisible();
  });

  it("Escape also goes back from a drill-in", async () => {
    await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Hero" }));
    await screen.findByTestId("builder-drill-in");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("builder-drill-in")).not.toBeInTheDocument());
  });

  it("a deep link opens the right drill-in directly", async () => {
    window.history.replaceState(null, "", "/theme/7/builder?panel=design&open=theme%3AColors");
    await renderBuilder();
    const drill = await screen.findByTestId("builder-drill-in");
    expect(within(drill).getByRole("heading", { name: "Colors" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
  });

  it("Design and Settings list only what applies, with the note, and the eye toggles a section without opening it", async () => {
    await renderBuilder();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    const design = screen.getByTestId("builder-list-design");
    expect(within(design).getByRole("button", { name: "Colors" })).toBeInTheDocument();
    // A published Sections theme: the legacy-chrome entries are not listed at all.
    expect(within(design).queryByRole("button", { name: "Homepage layout" })).not.toBeInTheDocument();
    expect(within(design).getByText("Only settings that apply to your theme are shown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const settings = screen.getByTestId("builder-list-settings");
    expect(within(settings).getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(within(settings).getByRole("button", { name: "Home tab" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Sections" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Hero" }));
    expect(await screen.findByRole("button", { name: "Show Hero" })).toBeInTheDocument();
    expect(screen.queryByTestId("builder-drill-in")).not.toBeInTheDocument();
  });
});
