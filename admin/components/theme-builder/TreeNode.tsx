"use client";

import { useState } from "react";
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
import { ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import { BLOCK_TYPE_LABELS, MAX_BLOCK_DEPTH, allowedBlockTypesFor, type BlockContainer, type ThemeBlock } from "@/lib/types";

interface TreeNodeListProps {
  blocks: ThemeBlock[];
  containerKind: BlockContainer;
  parentType: string | null;
  parentBlockId: string | null;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (parentBlockId: string | null, orderedIds: string[]) => void;
  onAddBlock: (parentBlockId: string | null, allowedTypes: string[]) => void;
  onDragActiveChange: (active: boolean) => void;
}

function BlockRow({
  block,
  props,
}: {
  block: ThemeBlock;
  props: TreeNodeListProps;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const childTypes = allowedBlockTypesFor(props.containerKind, block.type);
  const canExpand = (childTypes.length > 0 || (block.blocks?.length ?? 0) > 0) && props.depth + 1 < MAX_BLOCK_DEPTH;
  const [expanded, setExpanded] = useState(false);
  const selected = props.selectedId === block.id;

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "opacity-50" : ""}>
      <div
        className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
          selected ? "border-accent bg-accent/5" : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
        }`}
        style={{ paddingLeft: 8 + props.depth * 16 }}
      >
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="shrink-0 text-zinc-400"
          >
            <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {block.type === "nav_menu" ? (
          // The nav menu always renders as a fixed row below the header
          // (see ThemeDrivenHeader.tsx/MenuBar.tsx) — its order within
          // Header's block tree has no effect on the storefront, so a drag
          // handle here would promise repositioning this block can't do.
          <span aria-hidden="true" className="shrink-0 text-zinc-200 dark:text-zinc-700">
            <GripVertical className="size-3.5" />
          </span>
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="shrink-0 cursor-grab touch-none text-zinc-400 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        <button type="button" onClick={() => props.onSelect(block.id)} className="flex-1 truncate text-left text-sm">
          {BLOCK_TYPE_LABELS[block.type] ?? block.type}
        </button>
        <button
          type="button"
          onClick={() => props.onRemove(block.id)}
          aria-label="Remove block"
          className="hidden shrink-0 text-zinc-400 hover:text-red-500 group-hover:block"
        >
          <Trash2 className="size-3.5" />
        </button>
        <Toggle checked={block.visible} onChange={() => props.onToggleVisibility(block.id)} />
      </div>
      {canExpand && expanded && (
        <TreeNode
          {...props}
          blocks={block.blocks ?? []}
          parentBlockId={block.id}
          parentType={block.type}
          depth={props.depth + 1}
        />
      )}
    </div>
  );
}

// Recursive block-tree renderer — one component handles sections' own
// blocks, header/footer blocks, and every sub-block level, replacing Phase
// 6's flat SectionTree list + ElementDragZone. Each level gets its own
// DndContext scoped to just that level's siblings (cross-level dragging
// isn't a real use case here — a sub-block can't become a top-level block).
export default function TreeNode(props: TreeNodeListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ordered = [...props.blocks].sort((a, b) => a.order - b.order);
  const allowedTypes = allowedBlockTypesFor(props.containerKind, props.parentType);

  function handleDragEnd(event: DragEndEvent) {
    props.onDragActiveChange(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((b) => b.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...ids];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, String(active.id));
    props.onReorder(props.parentBlockId, next);
  }

  return (
    <div className="space-y-0.5" style={{ paddingLeft: props.depth > 0 ? 8 : 0 }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => props.onDragActiveChange(true)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => props.onDragActiveChange(false)}
      >
        <SortableContext items={ordered.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {ordered.map((block) => (
            <BlockRow key={block.id} block={block} props={props} />
          ))}
        </SortableContext>
      </DndContext>
      {allowedTypes.length > 0 && (
        <button
          type="button"
          onClick={() => props.onAddBlock(props.parentBlockId, allowedTypes)}
          className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-accent"
          style={{ paddingLeft: 8 + (props.depth + 1) * 16 }}
        >
          <Plus className="size-3" /> Add block
        </button>
      )}
    </div>
  );
}
