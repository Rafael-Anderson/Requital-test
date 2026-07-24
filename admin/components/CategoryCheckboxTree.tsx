import { buildCategoryTree, flattenCategoryTree, type Category } from "@/lib/types";
import Checkbox from "@/components/ui/Checkbox";

const TREE_INDENT = 20; // px per depth level

// Vertical guide-line technique adapted from Origin UI's
// "basic-tree-with-vertical-lines" on 21st.dev
// (https://21st.dev/@originui/components/tree/basic-tree-with-vertical-lines):
// a repeating-linear-gradient on a pseudo-element draws continuous vertical
// rails at each indent stop, keyed off a --tree-indent custom property.
// Their version drives an actual expandable/draggable tree via
// @headless-tree; here it's just that CSS trick applied to a flat
// depth-indexed checkbox list, with no new dependency.
export default function CategoryCheckboxTree({
  categories,
  selected,
  onToggle,
}: {
  categories: Category[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  const rows = flattenCategoryTree(buildCategoryTree(categories));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-400 border rounded-lg border-black/15 dark:border-white/15 px-3 py-4 text-center">
        No categories yet — create one on the Categories page first.
      </p>
    );
  }

  // repeating-linear-gradient tiles infinitely, so the pseudo-element's width
  // is capped to the deepest nesting actually present — otherwise it draws
  // guide lines across the full row width instead of stopping after the
  // last real indent level.
  const maxDepth = Math.max(...rows.map((r) => r.depth));
  const guideWidth = (maxDepth + 1) * TREE_INDENT;

  return (
    <div
      className="relative rounded-lg border border-black/15 dark:border-white/15 max-h-56 overflow-y-auto p-1.5 before:absolute before:top-0 before:bottom-0 before:left-0 before:-ml-1 before:w-(--tree-guide-width) before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),rgba(0,0,0,0.08)_calc(var(--tree-indent)-1px),rgba(0,0,0,0.08)_calc(var(--tree-indent)))] dark:before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),rgba(255,255,255,0.12)_calc(var(--tree-indent)-1px),rgba(255,255,255,0.12)_calc(var(--tree-indent)))]"
      style={{ "--tree-indent": `${TREE_INDENT}px`, "--tree-guide-width": `${guideWidth}px` } as React.CSSProperties}
    >
      {rows.map((c) => (
        <label
          key={c.id}
          style={{ paddingLeft: `${c.depth * TREE_INDENT + 8}px` }}
          className="relative z-10 flex items-center gap-2 text-sm py-1.5 pr-2 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
        >
          <Checkbox checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
          {c.name}
        </label>
      ))}
    </div>
  );
}
