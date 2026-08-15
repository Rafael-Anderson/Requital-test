import type { ThemeBlock } from "./types";

// Pure recursive tree primitives operating on a ThemeBlock[] forest (a
// container's top-level blocks, or any block's own sub-blocks) — the one
// place every block-mutating action in useThemeEditor.ts goes through, so
// arbitrary nesting depth (section -> block -> sub-block) is handled
// correctly everywhere instead of once per call site.

export function findNodeInTree(blocks: ThemeBlock[], id: string): ThemeBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.blocks) {
      const found = findNodeInTree(block.blocks, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateNodeInTree(
  blocks: ThemeBlock[],
  id: string,
  updater: (block: ThemeBlock) => ThemeBlock,
): ThemeBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.blocks) return { ...block, blocks: updateNodeInTree(block.blocks, id, updater) };
    return block;
  });
}

export function removeNodeFromTree(blocks: ThemeBlock[], id: string): ThemeBlock[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) => (block.blocks ? { ...block, blocks: removeNodeFromTree(block.blocks, id) } : block));
}

// parentId null inserts as a top-level sibling of `blocks` itself; a real id
// inserts as the last child of that block, wherever it is in the tree.
export function insertNodeInTree(blocks: ThemeBlock[], parentId: string | null, node: ThemeBlock): ThemeBlock[] {
  if (parentId === null) return [...blocks, node];
  return blocks.map((block) => {
    if (block.id === parentId) return { ...block, blocks: [...(block.blocks ?? []), node] };
    if (block.blocks) return { ...block, blocks: insertNodeInTree(block.blocks, parentId, node) };
    return block;
  });
}

// parentId null reorders `blocks` itself (call this at the top level with
// the exact array being reordered); a real id finds that block anywhere in
// the tree and reorders its own `.blocks`. orderedIds must be the full
// sibling id list in its new order (what @dnd-kit/sortable hands back) —
// any id not present in `blocks`/the found block's children is dropped.
export function reorderSiblingsInTree(
  blocks: ThemeBlock[],
  parentId: string | null,
  orderedIds: string[],
): ThemeBlock[] {
  function reorderList(list: ThemeBlock[]): ThemeBlock[] {
    const byId = new Map(list.map((b) => [b.id, b]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((b): b is ThemeBlock => b !== undefined)
      .map((b, i) => ({ ...b, order: i }));
  }
  if (parentId === null) return reorderList(blocks);
  return blocks.map((block) => {
    if (block.id === parentId) return { ...block, blocks: reorderList(block.blocks ?? []) };
    if (block.blocks) return { ...block, blocks: reorderSiblingsInTree(block.blocks, parentId, orderedIds) };
    return block;
  });
}
