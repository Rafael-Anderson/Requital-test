"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, Layout, PanelBottom, Plus, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import TreeNode from "./TreeNode";
import AddSectionModal from "./AddSectionModal";
import AddBlockModal from "./AddBlockModal";
import { findNodeInTree } from "@/lib/theme-tree";
import { SECTION_TYPE_LABELS, type ThemeSection } from "@/lib/types";
import { HEADER_CHROME_ID, FOOTER_CHROME_ID, type BlockContainerRef, type ThemeEditorState } from "@/lib/useThemeEditor";

export { HEADER_CHROME_ID, FOOTER_CHROME_ID };

interface AddBlockRequest {
  container: BlockContainerRef;
  parentBlockId: string | null;
  types: string[];
}

function ChromeRow({
  label,
  Icon,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
}: {
  label: string;
  Icon: typeof Layout;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 ${
        selected ? "border-accent bg-accent/5" : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      <button type="button" onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"} className="shrink-0 text-zinc-400">
        <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-2 truncate text-left text-sm font-medium">
        <Icon className="size-4 text-zinc-400" />
        {label}
      </button>
    </div>
  );
}

function SortableSectionRow({
  section,
  selected,
  expanded,
  onSelect,
  onToggleVisible,
  onToggleExpand,
  onRemove,
}: {
  section: ThemeSection;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleExpand: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "opacity-50" : ""}>
      <div
        className={`group flex items-center gap-1.5 rounded-lg border px-2 py-2 ${
          selected ? "border-accent bg-accent/5" : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <button type="button" onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"} className="shrink-0 text-zinc-400">
          <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder" className="shrink-0 cursor-grab touch-none text-zinc-400 active:cursor-grabbing">
          <GripVertical className="size-4" />
        </button>
        <button type="button" onClick={onSelect} className="flex-1 truncate text-left text-sm font-medium">
          {SECTION_TYPE_LABELS[section.type]}
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove section" className="hidden shrink-0 text-zinc-400 hover:text-red-500 group-hover:block">
          <Trash2 className="size-3.5" />
        </button>
        <Toggle checked={section.visible} onChange={onToggleVisible} />
      </div>
    </div>
  );
}

// Thin composition over TreeNode: Header (static, expandable) -> sortable
// list of body sections (each expandable to its own block tree) -> Footer
// (static, expandable). Replaces the old flat list + Phase 6's
// ElementDragZone entirely — every block/sub-block level renders through
// the one recursive TreeNode component instead.
export default function SectionTree({ editor }: { editor: ThemeEditorState }) {
  const { config, selectedId, selectNode, toggleSectionVisibility, reorderSections, addSection, removeSection, toggleBlockVisibility, removeBlock, reorderBlocks, addBlock } = editor;
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addBlockRequest, setAddBlockRequest] = useState<AddBlockRequest | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSelectedIdRef = useRef<string | null>(null);

  // Syncs the tree to a selection made elsewhere — specifically, a
  // double-click in the live preview (PreviewInteraction.tsx ->
  // PreviewFrame.tsx -> selectNode) — by expanding the block's containing
  // section (or Header/Footer) if collapsed and scrolling it into view.
  // Doesn't re-run for a selection the tree's own click already made (same
  // id twice in a row is a no-op here, harmless either way).
  useEffect(() => {
    if (!config || !selectedId || selectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = selectedId;

    let containingId: string | null = null;
    if (selectedId === HEADER_CHROME_ID || findNodeInTree(config.header.blocks, selectedId)) {
      containingId = HEADER_CHROME_ID;
    } else if (selectedId === FOOTER_CHROME_ID || findNodeInTree(config.footer.blocks, selectedId)) {
      containingId = FOOTER_CHROME_ID;
    } else {
      containingId = config.sections.find((s) => s.id === selectedId || findNodeInTree(s.blocks, selectedId))?.id ?? null;
    }
    if (!containingId) return;

    const resolvedId = containingId;
    setExpandedIds((prev) => (prev.has(resolvedId) ? prev : new Set(prev).add(resolvedId)));
    requestAnimationFrame(() => {
      containerRef.current?.querySelector(`[data-section-row="${window.CSS.escape(resolvedId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedId, config]);

  if (!config) return null;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ordered = [...config.sections].sort((a, b) => a.order - b.order);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((s) => s.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...ids];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, String(active.id));
    reorderSections(next);
  }

  function treeNodeFor(container: BlockContainerRef, containerKind: "header" | "footer" | ThemeSection["type"], blocks: ThemeSection["blocks"]) {
    return (
      <TreeNode
        blocks={blocks}
        containerKind={containerKind}
        parentType={null}
        parentBlockId={null}
        depth={1}
        selectedId={selectedId}
        onSelect={selectNode}
        onToggleVisibility={(id) => toggleBlockVisibility(container, id)}
        onRemove={(id) => removeBlock(container, id)}
        onReorder={(parentBlockId, orderedIds) => reorderBlocks(container, parentBlockId, orderedIds)}
        onAddBlock={(parentBlockId, types) => setAddBlockRequest({ container, parentBlockId, types })}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-3 p-3">
      <div data-section-row={HEADER_CHROME_ID}>
        <ChromeRow
          label="Header"
          Icon={Layout}
          selected={selectedId === HEADER_CHROME_ID}
          expanded={expandedIds.has(HEADER_CHROME_ID)}
          onSelect={() => selectNode(HEADER_CHROME_ID)}
          onToggleExpand={() => toggleExpanded(HEADER_CHROME_ID)}
        />
      </div>
      {expandedIds.has(HEADER_CHROME_ID) && treeNodeFor({ kind: "header" }, "header", config.header.blocks)}

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Template</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {ordered.map((section) => (
              <div key={section.id} data-section-row={section.id}>
                <SortableSectionRow
                  section={section}
                  selected={selectedId === section.id}
                  expanded={expandedIds.has(section.id)}
                  onSelect={() => selectNode(section.id)}
                  onToggleVisible={() => toggleSectionVisibility(section.id)}
                  onToggleExpand={() => toggleExpanded(section.id)}
                  onRemove={() => removeSection(section.id)}
                />
                {expandedIds.has(section.id) &&
                  treeNodeFor({ kind: "section", sectionId: section.id, sectionType: section.type }, section.type, section.blocks)}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <button
        type="button"
        onClick={() => setAddSectionOpen(true)}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-zinc-500 hover:border-black/30 hover:text-zinc-700 dark:border-white/15 dark:hover:border-white/30 dark:hover:text-zinc-300"
      >
        <Plus className="size-4" />
        Add section
      </button>

      <div data-section-row={FOOTER_CHROME_ID}>
        <ChromeRow
          label="Footer"
          Icon={PanelBottom}
          selected={selectedId === FOOTER_CHROME_ID}
          expanded={expandedIds.has(FOOTER_CHROME_ID)}
          onSelect={() => selectNode(FOOTER_CHROME_ID)}
          onToggleExpand={() => toggleExpanded(FOOTER_CHROME_ID)}
        />
      </div>
      {expandedIds.has(FOOTER_CHROME_ID) && treeNodeFor({ kind: "footer" }, "footer", config.footer.blocks)}

      {addSectionOpen && (
        <AddSectionModal
          onClose={() => setAddSectionOpen(false)}
          onPick={(type) => {
            addSection(type);
            setAddSectionOpen(false);
          }}
        />
      )}

      {addBlockRequest && (
        <AddBlockModal
          types={addBlockRequest.types}
          onClose={() => setAddBlockRequest(null)}
          onPick={(type) => {
            addBlock(addBlockRequest.container, addBlockRequest.parentBlockId, type);
            setAddBlockRequest(null);
          }}
        />
      )}
    </div>
  );
}
