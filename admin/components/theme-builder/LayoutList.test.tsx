import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LayoutList from "./LayoutList";
import type { ThemeEditorState } from "@/lib/useThemeEditor";
import type { BuilderContext } from "@/lib/theme-builder-registry";

afterEach(cleanup);

function editorFor(ctx: BuilderContext, layoutCategory: string | null = null) {
  const setLayoutCategory = vi.fn();
  return { editor: { builderContext: ctx, layoutCategory, setLayoutCategory } as unknown as ThemeEditorState, setLayoutCategory };
}

describe("LayoutList", () => {
  it("Sections mode renders only the applicable entries: no dead rows at all", () => {
    const { editor } = editorFor({ sectionsMode: true, sectionTypesPresent: new Set() });
    render(<LayoutList editor={editor} />);
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows).toEqual([
      "Home tab",
      "Menu",
      "Product page layout",
      "Cart layout",
      "Checkout layout",
      "Icon style",
      "Button shape",
      "Button fill",
    ]);
    for (const dead of ["Homepage layout", "Top bar layout", "Header size", "Footer layout", "Footer size"]) {
      expect(screen.queryByText(dead)).not.toBeInTheDocument();
    }
  });

  it("Layout mode renders all 13", () => {
    const { editor } = editorFor({ sectionsMode: false, sectionTypesPresent: new Set() });
    render(<LayoutList editor={editor} />);
    expect(screen.getAllByRole("button")).toHaveLength(13);
  });

  it("a stale selection that is hidden highlights the first applicable entry instead", () => {
    const { editor } = editorFor({ sectionsMode: true, sectionTypesPresent: new Set() }, "Top bar layout");
    render(<LayoutList editor={editor} />);
    expect(screen.getByRole("button", { name: "Home tab" })).toHaveAttribute("aria-current", "true");
  });

  it("clicking an entry selects it", async () => {
    const user = userEvent.setup();
    const { editor, setLayoutCategory } = editorFor({ sectionsMode: true, sectionTypesPresent: new Set() });
    render(<LayoutList editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Cart layout" }));
    expect(setLayoutCategory).toHaveBeenCalledWith("Cart layout");
  });
});
