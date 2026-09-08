import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeaturedCollectionsSettings from "./FeaturedCollectionsSettings";

vi.mock("@/lib/api", () => ({
  listCollections: () => Promise.resolve([{ id: 1, name: "Roses" }]),
  uploadThemeImage: vi.fn(),
  resolveImageUrl: (u: string) => u,
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

describe("FeaturedCollectionsSettings — Phase 4 tile controls", () => {
  it("renders Columns, Tile shape, and the name-overlay toggle", () => {
    render(<FeaturedCollectionsSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText("Columns")).toBeInTheDocument();
    expect(screen.getByLabelText("Tile shape")).toBeInTheDocument();
    expect(screen.getByText("Name over the image")).toBeInTheDocument();
  });

  it("changing Columns calls onUpdate('columns', number)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<FeaturedCollectionsSettings settings={{}} onUpdate={onUpdate} />);
    await user.selectOptions(screen.getByLabelText("Columns"), "5");
    expect(onUpdate).toHaveBeenCalledWith("columns", 5);
  });

  it("offers up to 8 columns for large tiles", () => {
    render(<FeaturedCollectionsSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByRole("option", { name: "8" })).toBeInTheDocument();
  });
});

describe("FeaturedCollectionsSettings — display style (#9/#14)", () => {
  it("switching to Quick icons hides the tile-only controls", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const { rerender } = render(<FeaturedCollectionsSettings settings={{}} onUpdate={onUpdate} />);
    await user.selectOptions(screen.getByLabelText("Display style"), "quick_icons");
    expect(onUpdate).toHaveBeenCalledWith("displayStyle", "quick_icons");

    rerender(<FeaturedCollectionsSettings settings={{ displayStyle: "quick_icons" }} onUpdate={onUpdate} />);
    expect(screen.queryByLabelText("Columns")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tile shape")).not.toBeInTheDocument();
    expect(screen.queryByText("Name over the image")).not.toBeInTheDocument();
  });

  it("switching back to Large tiles clears the setting (byte-identical default)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<FeaturedCollectionsSettings settings={{ displayStyle: "quick_icons" }} onUpdate={onUpdate} />);
    await user.selectOptions(screen.getByLabelText("Display style"), "tiles");
    expect(onUpdate).toHaveBeenCalledWith("displayStyle", undefined);
  });
});

describe("FeaturedCollectionsSettings — heading write-through (#9/#14)", () => {
  const section = {
    id: "sec-1",
    type: "featured_collections" as const,
    blocks: [
      {
        id: "hdr",
        type: "collection_header",
        visible: true,
        blocks: [{ id: "title-1", type: "collection_title", visible: true, settings: { text: "Shop by occasion" } }],
      },
    ],
  };

  it("edits the collection_title sub-block directly via editor.updateBlockSetting", async () => {
    const user = userEvent.setup();
    const updateBlockSetting = vi.fn();
    const editor = { selection: { kind: "section", section }, updateBlockSetting } as never;
    render(<FeaturedCollectionsSettings settings={{}} onUpdate={vi.fn()} editor={editor} />);

    const heading = screen.getByLabelText("Heading");
    expect(heading).toHaveValue("Shop by occasion");
    await user.clear(heading);
    expect(updateBlockSetting).toHaveBeenLastCalledWith(
      { kind: "section", sectionId: "sec-1", sectionType: "featured_collections" },
      "title-1",
      "text",
      "",
    );
  });

  it("renders no Heading field without an editor (falls back to the tree)", () => {
    render(<FeaturedCollectionsSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.queryByLabelText("Heading")).not.toBeInTheDocument();
  });
});
