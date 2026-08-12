"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ELEMENT_LABELS } from "@/lib/default-theme-elements";
import type { ThemeElement } from "@/lib/types";

function DraggableChip({ element }: { element: ThemeElement }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: element.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex cursor-grab touch-none items-center gap-1.5 rounded-md border border-black/15 bg-white px-2 py-1.5 text-xs font-medium shadow-sm active:cursor-grabbing dark:border-white/15 dark:bg-zinc-900 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <GripVertical className="size-3 shrink-0 text-zinc-400" />
      {ELEMENT_LABELS[element.type] ?? element.type}
    </div>
  );
}

function DropZone({
  zoneKey,
  label,
  elements,
}: {
  zoneKey: string;
  label: string;
  elements: ThemeElement[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneKey });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-24 flex-col gap-1.5 rounded-lg border border-dashed p-2 ${
        isOver ? "border-accent bg-accent/5" : "border-black/15 dark:border-white/15"
      }`}
    >
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      {elements.map((el) => (
        <DraggableChip key={el.id} element={el} />
      ))}
    </div>
  );
}

// Freeform element positioning within a section's own drag context — a
// separate, nested DndContext from SectionTree's own section-reorder
// context, per the spec. Zone-based (drag a chip into one of three drop
// zones), not continuous pixel x/y — a deliberate scope reduction from a
// full canvas-style editor, which this settings-panel-embedded control
// isn't built for; zone-based dropping is how comparable page builders
// (e.g. Shopify's own header editor) actually implement this, not a
// simplification unique to this codebase.
export default function ElementDragZone({
  elements,
  zones,
  onChange,
}: {
  elements: ThemeElement[];
  zones: { key: string; label: string }[];
  onChange: (elements: ThemeElement[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const targetZone = String(over.id);
    onChange(
      elements.map((el) =>
        el.id === active.id ? { ...el, position: { ...el.position, zone: targetZone } } : el,
      ),
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-3 gap-2">
        {zones.map((zone) => (
          <DropZone
            key={zone.key}
            zoneKey={zone.key}
            label={zone.label}
            elements={elements.filter((el) => el.position.zone === zone.key)}
          />
        ))}
      </div>
    </DndContext>
  );
}
