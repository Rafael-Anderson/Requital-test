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
import { GripVertical, Layout, PanelBottom, Plus } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import { SECTION_TYPE_LABELS, type ThemeSection } from "@/lib/types";
import AddSectionModal from "./AddSectionModal";

// Sentinel ids for the two fixed global-chrome rows — Header/Footer aren't
// members of ThemeConfig.sections[] (see the plan's scope decision: they're
// pinned to every page, not part of the reorderable homepage-body list), so
// they can't collide with a real section's `sec-...` id.
export const HEADER_CHROME_ID = "__header__";
export const FOOTER_CHROME_ID = "__footer__";

function SortableSectionRow({
  section,
  selected,
  onSelect,
  onToggleVisible,
}: {
  section: ThemeSection;
  selected: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${
        isDragging ? "opacity-50" : ""
      } ${
        selected
          ? "border-accent bg-accent/5"
          : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab touch-none text-zinc-400 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 truncate text-left text-sm font-medium"
      >
        {SECTION_TYPE_LABELS[section.type]}
      </button>
      <Toggle checked={section.visible} onChange={onToggleVisible} />
    </div>
  );
}

export default function SectionTree({
  sections,
  selectedSectionId,
  onSelectSection,
  onToggleVisibility,
  onReorder,
  onAddSection,
  onRemoveSection,
}: {
  sections: ThemeSection[];
  selectedSectionId: string | null;
  onSelectSection: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddSection: (type: ThemeSection["type"]) => void;
  onRemoveSection: (id: string) => void;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ordered = [...sections].sort((a, b) => a.order - b.order);

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
    onReorder(next);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <button
        type="button"
        onClick={() => onSelectSection(HEADER_CHROME_ID)}
        className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm font-medium ${
          selectedSectionId === HEADER_CHROME_ID
            ? "border-accent bg-accent/5"
            : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <Layout className="size-4 text-zinc-400" />
        Header
      </button>

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {ordered.map((section) => (
              <div key={section.id} className="group relative">
                <SortableSectionRow
                  section={section}
                  selected={selectedSectionId === section.id}
                  onSelect={() => onSelectSection(section.id)}
                  onToggleVisible={() => onToggleVisibility(section.id)}
                />
                <button
                  type="button"
                  onClick={() => onRemoveSection(section.id)}
                  aria-label="Remove section"
                  className="absolute -right-0.5 -top-1.5 hidden size-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white group-hover:flex"
                >
                  ×
                </button>
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <button
        type="button"
        onClick={() => setAddModalOpen(true)}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-zinc-500 hover:border-black/30 hover:text-zinc-700 dark:border-white/15 dark:hover:border-white/30 dark:hover:text-zinc-300"
      >
        <Plus className="size-4" />
        Add section
      </button>

      <button
        type="button"
        onClick={() => onSelectSection(FOOTER_CHROME_ID)}
        className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm font-medium ${
          selectedSectionId === FOOTER_CHROME_ID
            ? "border-accent bg-accent/5"
            : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <PanelBottom className="size-4 text-zinc-400" />
        Footer
      </button>

      {addModalOpen && (
        <AddSectionModal
          onClose={() => setAddModalOpen(false)}
          onPick={(type) => {
            onAddSection(type);
            setAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
