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
});
