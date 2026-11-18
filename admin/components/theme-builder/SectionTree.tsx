"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import TreeNode from "./TreeNode";
import VisibilityButton from "./VisibilityButton";
import AddSectionModal from "./AddSectionModal";
import AddBlockModal from "./AddBlockModal";
import { findNodeInTree } from "@/lib/theme-tree";
import { SECTION_TYPE_LABELS, type AnnouncementBarConfig, type ThemeSection } from "@/lib/types";
import { ANNOUNCEMENT_CHROME_ID, HEADER_CHROME_ID, FOOTER_CHROME_ID, type BlockContainerRef, type ThemeEditorState } from "@/lib/useThemeEditor";

export { ANNOUNCEMENT_CHROME_ID, HEADER_CHROME_ID, FOOTER_CHROME_ID };

interface AddBlockRequest {
  container: BlockContainerRef;
  parentBlockId: string | null;
  types: string[];
}

type GroupKey = "header" | "template" | "footer";
const COLLAPSED_STORAGE_KEY = "requital.themeBuilder.collapsedGroups";

function readCollapsed(): Set<GroupKey> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed.filter((g) => g === "header" || g === "template" || g === "footer") as GroupKey[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(groups: Set<GroupKey>) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // Storage unavailable (private window, blocked site data): the panel still works.
  }
}

// An 11px uppercase group label that collapses its group.
function GroupLabel({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${label} group`}
      className="flex h-8 w-full cursor-pointer items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint hover:text-text-muted"
    >
      <ChevronRight className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden />
      {label}
    </button>
  );
}

function Expander({ expanded, onToggle, label }: { expanded: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      aria-expanded={expanded}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-faint hover:text-text-muted"
    >
      <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
    </button>
  );
}

// A fixed (not draggable) row: the announcement bar, Header, Footer.
function ChromeRow({
  rowId,
  label,
  selected,
  onSelect,
  expander,
  trailing,
  dimmed,
}: {
  rowId: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  expander?: ReactNode;
  trailing?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div
      data-section-row={rowId}
      className={`group flex h-[34px] items-center gap-1 rounded-md pe-1 ps-1 ${
        selected ? "bg-accent-tint text-accent-text" : "hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      {expander ?? <span className="size-5 shrink-0" aria-hidden />}
      <span className="size-4 shrink-0" aria-hidden />
      <button
        type="button"
        onClick={onSelect}
        className={`min-w-0 flex-1 cursor-pointer truncate text-start text-[13px] font-medium ${dimmed ? "opacity-60" : ""}`}
      >
        {label}
      </button>
      {trailing}
    </div>
  );
}

function SortableSectionRow({
  section,
  selected,
  expanded,
  dropLine,
  onSelect,
  onToggleVisible,
  onToggleExpand,
}: {
  section: ThemeSection;
  selected: boolean;
  expanded: boolean;
  dropLine: "before" | "after" | null;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleExpand: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const name = SECTION_TYPE_LABELS[section.type];

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative ${isDragging ? "opacity-50" : ""}`}>
      {dropLine && (
        <span
          aria-hidden
          data-drop-indicator
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent ${dropLine === "before" ? "-top-px" : "-bottom-px"}`}
        />
      )}
      <div
        data-section-row={section.id}
        className={`group flex h-[34px] items-center gap-1 rounded-md pe-1 ps-1 ${
          selected ? "bg-accent-tint text-accent-text" : "hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <Expander expanded={expanded} onToggle={onToggleExpand} label={name} />
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${name}`}
          className="flex size-4 shrink-0 cursor-grab touch-none items-center justify-center text-text-faint active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          className={`min-w-0 flex-1 cursor-pointer truncate text-start text-[13px] font-medium ${section.visible ? "" : "opacity-60"}`}
        >
          {name}
        </button>
        <VisibilityButton visible={section.visible} name={name} onToggle={onToggleVisible} />
      </div>
    </div>
  );
}

// The Sections tab: HEADER (announcement bar, Header with its blocks), TEMPLATE (the page's sections,
// drag to reorder, "+ Add section") and FOOTER, each group collapsible. Clicking a row opens its
// settings in the same panel (the drill-in); the eye toggles visibility without opening it.
export default function SectionTree({ editor }: { editor: ThemeEditorState }) {
  const { config, selectedId, selectNode, toggleSectionVisibility, reorderSections, addSection, toggleBlockVisibility, removeBlock, reorderBlocks, addBlock, setIsDragging } = editor;
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addBlockRequest, setAddBlockRequest] = useState<AddBlockRequest | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // The tree only mounts in the browser, after the editor has loaded, so storage can be read here.
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(() => (typeof window === "undefined" ? new Set() : readCollapsed()));
  const [drag, setDrag] = useState<{ activeId: string; overId: string | null } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSelectedIdRef = useRef<string | null>(null);

  // A selection made elsewhere (a preview click, a search result) expands the group and the row that
  // contains it, so Back lands on a tree that shows where the item lives.
  useEffect(() => {
    if (!config || !selectedId || selectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = selectedId;

    let containingId: string | null = null;
    let group: GroupKey = "template";
    if (selectedId === ANNOUNCEMENT_CHROME_ID) {
      group = "header";
    } else if (selectedId === HEADER_CHROME_ID || findNodeInTree(config.header.blocks, selectedId)) {
      containingId = selectedId === HEADER_CHROME_ID ? null : HEADER_CHROME_ID;
      group = "header";
    } else if (selectedId === FOOTER_CHROME_ID || findNodeInTree(config.footer.blocks, selectedId)) {
      containingId = selectedId === FOOTER_CHROME_ID ? null : FOOTER_CHROME_ID;
      group = "footer";
    } else {
      containingId = config.sections.find((s) => findNodeInTree(s.blocks, selectedId))?.id ?? null;
    }
    setCollapsed((prev) => {
      if (!prev.has(group)) return prev;
      const next = new Set(prev);
      next.delete(group);
      writeCollapsed(next);
      return next;
    });
    if (containingId) {
      const resolvedId = containingId;
      setExpandedIds((prev) => (prev.has(resolvedId) ? prev : new Set(prev).add(resolvedId)));
    }
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

  function toggleGroup(group: GroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      writeCollapsed(next);
      return next;
    });
  }

  const ordered = [...config.sections].sort((a, b) => a.order - b.order);
  const orderedIds = ordered.map((s) => s.id);

  function handleDragOver(event: DragOverEvent) {
    setDrag({ activeId: String(event.active.id), overId: event.over ? String(event.over.id) : null });
  }

  function handleDragEnd(event: DragEndEvent) {
    setIsDragging(false);
    setDrag(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...orderedIds];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, String(active.id));
    reorderSections(next);
  }

  function dropLineFor(id: string): "before" | "after" | null {
    if (!drag || !drag.overId || drag.overId !== id || drag.overId === drag.activeId) return null;
    return orderedIds.indexOf(drag.overId) < orderedIds.indexOf(drag.activeId) ? "before" : "after";
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
        onReorder={(parentBlockId, ids) => reorderBlocks(container, parentBlockId, ids)}
        onAddBlock={(parentBlockId, types) => setAddBlockRequest({ container, parentBlockId, types })}
        onDragActiveChange={setIsDragging}
      />
    );
  }

  const announcement = config.header.settings.announcementBar as AnnouncementBarConfig | undefined;
  const announcementOn = !!announcement?.enabled;

  return (
    <div ref={containerRef} className="flex flex-col gap-1 p-2">
      <section aria-label="Header">
        <GroupLabel label="Header" collapsed={collapsed.has("header")} onToggle={() => toggleGroup("header")} />
        {!collapsed.has("header") && (
          <div className="space-y-0.5">
            <ChromeRow
              rowId={ANNOUNCEMENT_CHROME_ID}
              label="Announcement bar"
              selected={selectedId === ANNOUNCEMENT_CHROME_ID}
              onSelect={() => selectNode(ANNOUNCEMENT_CHROME_ID)}
              dimmed={!announcementOn}
              trailing={
                <VisibilityButton visible={announcementOn} name="Announcement bar" onToggle={() => editor.setAnnouncementEnabled(!announcementOn)} />
              }
            />
            <ChromeRow
              rowId={HEADER_CHROME_ID}
              label="Header"
              selected={selectedId === HEADER_CHROME_ID}
              onSelect={() => selectNode(HEADER_CHROME_ID)}
              expander={<Expander expanded={expandedIds.has(HEADER_CHROME_ID)} onToggle={() => toggleExpanded(HEADER_CHROME_ID)} label="Header" />}
            />
            {expandedIds.has(HEADER_CHROME_ID) && treeNodeFor({ kind: "header" }, "header", config.header.blocks)}
          </div>
        )}
      </section>

      <section aria-label="Template">
        <GroupLabel label="Template" collapsed={collapsed.has("template")} onToggle={() => toggleGroup("template")} />
        {!collapsed.has("template") && (
          <div className="space-y-0.5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => {
                setIsDragging(true);
                setDrag({ activeId: String(e.active.id), overId: null });
              }}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => {
                setIsDragging(false);
                setDrag(null);
              }}
            >
              <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                {ordered.map((section) => (
                  <div key={section.id}>
                    <SortableSectionRow
                      section={section}
                      selected={selectedId === section.id}
                      expanded={expandedIds.has(section.id)}
                      dropLine={dropLineFor(section.id)}
                      onSelect={() => selectNode(section.id)}
                      onToggleVisible={() => toggleSectionVisibility(section.id)}
                      onToggleExpand={() => toggleExpanded(section.id)}
                    />
                    {expandedIds.has(section.id) &&
                      treeNodeFor({ kind: "section", sectionId: section.id, sectionType: section.type }, section.type, section.blocks)}
                  </div>
                ))}
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={() => setAddSectionOpen(true)}
              className="mt-1 flex h-[34px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-[13px] font-medium text-text-muted hover:border-accent hover:text-accent-text dark:border-white/15"
            >
              <Plus className="size-4" aria-hidden />
              Add section
            </button>
          </div>
        )}
      </section>

      <section aria-label="Footer">
        <GroupLabel label="Footer" collapsed={collapsed.has("footer")} onToggle={() => toggleGroup("footer")} />
        {!collapsed.has("footer") && (
          <div className="space-y-0.5">
            <ChromeRow
              rowId={FOOTER_CHROME_ID}
              label="Footer"
              selected={selectedId === FOOTER_CHROME_ID}
              onSelect={() => selectNode(FOOTER_CHROME_ID)}
              expander={<Expander expanded={expandedIds.has(FOOTER_CHROME_ID)} onToggle={() => toggleExpanded(FOOTER_CHROME_ID)} label="Footer" />}
            />
            {expandedIds.has(FOOTER_CHROME_ID) && treeNodeFor({ kind: "footer" }, "footer", config.footer.blocks)}
          </div>
        )}
      </section>

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
