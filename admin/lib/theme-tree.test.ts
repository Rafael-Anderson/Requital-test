import { describe, expect, it } from "vitest";
import {
  findNodeInTree,
  insertNodeInTree,
  reorderById,
  removeNodeFromTree,
  reorderSiblingsInTree,
  updateNodeInTree,
} from "./theme-tree";
import type { ThemeBlock } from "./types";

function block(id: string, overrides: Partial<ThemeBlock> = {}): ThemeBlock {
  return { id, type: "text", visible: true, order: 0, settings: {}, ...overrides };
}

function tree(): ThemeBlock[] {
  return [
    block("a", { order: 0 }),
    block("b", {
      order: 1,
      blocks: [block("b1", { order: 0 }), block("b2", { order: 1 })],
    }),
    block("c", { order: 2 }),
  ];
}

describe("findNodeInTree", () => {
  it("finds a top-level node", () => {
    expect(findNodeInTree(tree(), "a")?.id).toBe("a");
  });

  it("finds a nested sub-block", () => {
    expect(findNodeInTree(tree(), "b2")?.id).toBe("b2");
  });

  it("returns null for an unknown id", () => {
    expect(findNodeInTree(tree(), "missing")).toBeNull();
  });
});

describe("updateNodeInTree", () => {
  it("updates a top-level node without touching siblings", () => {
    const result = updateNodeInTree(tree(), "a", (b) => ({ ...b, visible: false }));
    expect(result.find((b) => b.id === "a")?.visible).toBe(false);
    expect(result.find((b) => b.id === "c")?.visible).toBe(true);
  });

  it("updates a nested sub-block in place", () => {
    const result = updateNodeInTree(tree(), "b1", (b) => ({ ...b, settings: { text: "hi" } }));
    const b = result.find((n) => n.id === "b");
    expect(b?.blocks?.find((n) => n.id === "b1")?.settings).toEqual({ text: "hi" });
    expect(b?.blocks?.find((n) => n.id === "b2")?.settings).toEqual({});
  });
});

describe("removeNodeFromTree", () => {
  it("removes a top-level node", () => {
    const result = removeNodeFromTree(tree(), "a");
    expect(result.map((b) => b.id)).toEqual(["b", "c"]);
  });

  it("removes a nested sub-block, leaving its siblings and parent intact", () => {
    const result = removeNodeFromTree(tree(), "b1");
    const b = result.find((n) => n.id === "b");
    expect(b?.blocks?.map((n) => n.id)).toEqual(["b2"]);
  });
});

describe("insertNodeInTree", () => {
  it("inserts a top-level sibling when parentId is null", () => {
    const result = insertNodeInTree(tree(), null, block("d"));
    expect(result.map((b) => b.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("inserts as the last child of the given parent, anywhere in the tree", () => {
    const result = insertNodeInTree(tree(), "b", block("b3"));
    const b = result.find((n) => n.id === "b");
    expect(b?.blocks?.map((n) => n.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("creates a blocks array on a parent that previously had none", () => {
    const result = insertNodeInTree(tree(), "a", block("a1"));
    const a = result.find((n) => n.id === "a");
    expect(a?.blocks?.map((n) => n.id)).toEqual(["a1"]);
  });
});

describe("reorderById", () => {
  interface Section {
    id: string;
    order: number;
  }
  function section(id: string, order: number): Section {
    return { id, order };
  }
  function sections(): Section[] {
    return [section("a", 0), section("b", 1), section("c", 2)];
  }

  // Mirrors SectionTree.tsx's handleDragEnd -> useThemeEditor.ts's
  // reorderSections call chain: dnd-kit hands back the full sibling id
  // list in its new order, which is what this test asserts against
  // directly (a pure function, not a DOM drag simulation) — the same
  // shape TreeNode.tsx's block-level handleDragEnd feeds into
  // reorderSiblingsInTree below, which is why both share this one helper.
  it("reorders a flat list to match orderedIds and reassigns sequential order", () => {
    const result = reorderById(sections(), ["c", "a", "b"]);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(result.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("moving the first item to the second position swaps exactly those two, third stays put", () => {
    // The literal shape of a single-position drag-and-drop (a -> after b).
    const result = reorderById(sections(), ["b", "a", "c"]);
    expect(result.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("drops any id not present in the original list", () => {
    const result = reorderById(sections(), ["c", "a", "b", "missing"]);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("preserves every other field on each item, only order changes", () => {
    interface Section2 extends Section {
      visible: boolean;
    }
    const items: Section2[] = [
      { id: "a", order: 0, visible: true },
      { id: "b", order: 1, visible: false },
    ];
    const result = reorderById(items, ["b", "a"]);
    expect(result).toEqual([
      { id: "b", order: 0, visible: false },
      { id: "a", order: 1, visible: true },
    ]);
  });

  it("does not mutate the input array", () => {
    const original = sections();
    const snapshot = original.map((s) => ({ ...s }));
    reorderById(original, ["c", "b", "a"]);
    expect(original).toEqual(snapshot);
  });
});

describe("reorderSiblingsInTree", () => {
  it("reorders the top-level list when parentId is null, dropping unknown ids", () => {
    const result = reorderSiblingsInTree(tree(), null, ["c", "a", "b", "missing"]);
    expect(result.map((b) => b.id)).toEqual(["c", "a", "b"]);
    expect(result.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it("reorders a nested sibling list without touching the top level", () => {
    const result = reorderSiblingsInTree(tree(), "b", ["b2", "b1"]);
    expect(result.map((b) => b.id)).toEqual(["a", "b", "c"]);
    const b = result.find((n) => n.id === "b");
    expect(b?.blocks?.map((n) => n.id)).toEqual(["b2", "b1"]);
    expect(b?.blocks?.map((n) => n.order)).toEqual([0, 1]);
  });
});
