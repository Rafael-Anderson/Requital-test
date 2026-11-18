"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Copy, Trash2 } from "lucide-react";
import SectionTree from "./SectionTree";
import VisibilityButton from "./VisibilityButton";
import { EntrySettingsBody, NodeSettingsBody } from "./SettingsPanel";
import {
  BUILDER_TABS,
  PANEL_PLACEMENTS,
  entriesForTab,
  entryKey,
  entryLabel,
  isEntryApplicable,
  type BuilderTab,
  type PanelEntry,
} from "@/lib/theme-builder-panel";
import { BLOCK_TYPE_LABELS, SECTION_TYPE_LABELS, type AnnouncementBarConfig } from "@/lib/types";
import type { Selection, ThemeEditorState } from "@/lib/useThemeEditor";

export const APPLICABLE_NOTE = "Only settings that apply to your theme are shown";

function GroupHeading({ children }: { children: ReactNode }) {
  return <p className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint first:pt-1">{children}</p>;
}

function TabSwitcher({ tab, onChange }: { tab: BuilderTab; onChange: (tab: BuilderTab) => void }) {
  return (
    <div role="tablist" aria-label="Builder panel" className="flex gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/10">
      {BUILDER_TABS.map(({ key, label }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`builder-tab-${key}`}
            aria-selected={active}
            aria-controls={`builder-tabpanel-${key}`}
            onClick={() => onChange(key)}
            className={`h-7 min-w-0 flex-1 cursor-pointer rounded-md text-[13px] font-medium transition-colors ${
              active ? "bg-surface text-text-primary shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function EntryList({ editor, tab }: { editor: ThemeEditorState; tab: "design" | "settings" }) {
  const groups = entriesForTab(tab, editor.builderContext);
  return (
    <div className="p-2">
      {groups.map(({ group, entries }) => (
        <section key={group} aria-label={group}>
          <GroupHeading>{group}</GroupHeading>
          <div className="space-y-0.5">
            {entries.map((entry) => (
              <button
                key={entryKey(entry)}
                type="button"
                onClick={() => editor.openPanelEntry(entry)}
                className="flex h-[34px] w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-start text-[13px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span className="truncate">{entryLabel(entry)}</span>
                <ChevronRight className="size-3.5 shrink-0 text-text-faint rtl:rotate-180" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="px-1 pb-2 pt-4 text-xs text-text-faint">{APPLICABLE_NOTE}</p>
    </div>
  );
}

interface DrillMeta {
  title: string;
  context: string;
  visibility?: { visible: boolean; toggle: () => void };
  duplicate?: () => void;
  remove?: { label: string; run: () => void };
}

function nodeMeta(editor: ThemeEditorState, selection: Selection): DrillMeta {
  const config = editor.config!;
  const ordered = [...config.sections].sort((a, b) => a.order - b.order);
  if (selection.kind === "announcement") {
    const on = !!(config.header.settings.announcementBar as AnnouncementBarConfig | undefined)?.enabled;
    return { title: "Announcement bar", context: "Header", visibility: { visible: on, toggle: () => editor.setAnnouncementEnabled(!on) } };
  }
  if (selection.kind === "header") return { title: "Header", context: "Header" };
  if (selection.kind === "footer") return { title: "Footer", context: "Footer" };
  if (selection.kind === "section") {
    const { section } = selection;
    const index = ordered.findIndex((s) => s.id === section.id);
    return {
      title: SECTION_TYPE_LABELS[section.type],
      context: `Template · Section ${index + 1} of ${ordered.length}`,
      visibility: { visible: section.visible, toggle: () => editor.toggleSectionVisibility(section.id) },
      duplicate: () => editor.duplicateSection(section.id),
      remove: { label: "Remove section", run: () => editor.removeSection(section.id) },
    };
  }
  const { block, container } = selection;
  const where =
    container.kind === "header"
      ? "Header"
      : container.kind === "footer"
        ? "Footer"
        : `Template · ${SECTION_TYPE_LABELS[container.sectionType]}`;
  return {
    title: BLOCK_TYPE_LABELS[block.type] ?? block.type,
    context: `${where} · Block`,
    visibility: { visible: block.visible, toggle: () => editor.toggleBlockVisibility(container, block.id) },
    remove: { label: "Remove block", run: () => editor.removeBlock(container, block.id) },
  };
}

function entryMeta(entry: PanelEntry): DrillMeta {
  const placement = PANEL_PLACEMENTS.find((p) => entryKey(p.entry) === entryKey(entry));
  const tabLabel = placement?.tab === "design" ? "Design" : "Settings";
  return { title: entryLabel(entry), context: placement ? `${tabLabel} · ${placement.group}` : tabLabel };
}

// The child blocks of the selected section / header / footer, listed as rows so they can be opened
// from the drill-in too (the tree shows them as well).
function ContentBlocks({ editor, selection }: { editor: ThemeEditorState; selection: Selection }) {
  const config = editor.config!;
  const blocks =
    selection.kind === "section"
      ? selection.section.blocks
      : selection.kind === "header"
        ? config.header.blocks
        : selection.kind === "footer"
          ? config.footer.blocks
          : selection.kind === "block"
            ? (selection.block.blocks ?? [])
            : [];
  if (blocks.length === 0) return null;
  const ordered = [...blocks].sort((a, b) => a.order - b.order);
  return (
    <section aria-label="Content" className="mb-2">
      <GroupHeading>Content</GroupHeading>
      <div className="space-y-0.5">
        {ordered.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => editor.selectNode(b.id)}
            className={`flex h-[34px] w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-start text-[13px] hover:bg-black/5 dark:hover:bg-white/10 ${
              b.visible ? "" : "opacity-60"
            }`}
          >
            <span className="truncate">{BLOCK_TYPE_LABELS[b.type] ?? b.type}</span>
            <ChevronRight className="size-3.5 shrink-0 text-text-faint rtl:rotate-180" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

function DrillIn({ editor, meta, onBack, children }: { editor: ThemeEditorState; meta: DrillMeta; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="builder-drill-in">
      <div className="flex shrink-0 items-start gap-1 border-b border-border px-2 py-2 dark:border-white/10">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1 py-0.5">
          <h2 className="truncate text-sm font-semibold text-text-primary dark:text-zinc-50">{meta.title}</h2>
          <p className="truncate text-xs text-text-faint">{meta.context}</p>
        </div>
        <div className="flex shrink-0 items-center">
          {meta.visibility && (
            <VisibilityButton visible={meta.visibility.visible} name={meta.title} onToggle={meta.visibility.toggle} className="size-8" />
          )}
          {meta.duplicate && (
            <button
              type="button"
              onClick={meta.duplicate}
              aria-label={`Duplicate ${meta.title}`}
              title="Duplicate"
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
            >
              <Copy className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="builder-drill-body min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1" data-editor-key={editor.selectedId ?? ""}>
        {children}
      </div>
      {meta.remove && (
        <div className="shrink-0 border-t border-border px-3 py-2 dark:border-white/10">
          <button
            type="button"
            onClick={meta.remove.run}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-danger-text hover:bg-danger-bg"
          >
            <Trash2 className="size-4" aria-hidden />
            {meta.remove.label}
          </button>
        </div>
      )}
    </div>
  );
}

// True when Escape should be left to something else that is open (a modal, an expanded listbox or
// menu) or was already handled.
function escapeBelongsElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  const target = e.target;
  if (target instanceof Element && target.closest('[aria-expanded="true"]')) return true;
  return !!document.querySelector('[role="listbox"]:not([hidden]), [role="menu"]:not([hidden])');
}

// The single left panel: Sections / Design / Settings. A row (or a search result, or a preview
// click) replaces the panel's content with that item's settings, in the same panel; Back, Escape
// and the browser's back button return to the list with its scroll position kept.
export default function BuilderPanel({ editor }: { editor: ThemeEditorState }) {
  const { panelTab, panelView, selection, config } = editor;
  const listRefs = useRef<Record<BuilderTab, HTMLDivElement | null>>({ sections: null, design: null, settings: null });
  const savedScroll = useRef<Record<BuilderTab, number>>({ sections: 0, design: 0, settings: 0 });

  const sectionDrill = panelView.tab === "sections" && !!panelView.nodeId && !!selection;
  const entryDrill =
    panelView.tab !== "sections" && !!panelView.entry && isEntryApplicable(panelView.entry, editor.builderContext) ? panelView.entry : null;
  const drilled = sectionDrill || !!entryDrill;

  // Keep each list's scroll position across a drill-in: record it while the list is showing,
  // restore it when the list comes back.
  useLayoutEffect(() => {
    const el = listRefs.current[panelTab];
    if (!el) return;
    if (!drilled) el.scrollTop = savedScroll.current[panelTab];
  }, [drilled, panelTab]);

  function rememberScroll(tab: BuilderTab) {
    const el = listRefs.current[tab];
    if (el) savedScroll.current[tab] = el.scrollTop;
  }

  useEffect(() => {
    if (!drilled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || escapeBelongsElsewhere(e)) return;
      e.preventDefault();
      editor.requestDrillBack();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drilled, editor]);

  if (!config) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-zinc-900">
      <div className="shrink-0 border-b border-border p-2 dark:border-white/10">
        <TabSwitcher
          tab={panelTab}
          onChange={(tab) => {
            rememberScroll(panelTab);
            editor.switchTab(tab);
          }}
        />
      </div>

      {BUILDER_TABS.map(({ key }) => (
        <div
          key={key}
          ref={(el) => {
            listRefs.current[key] = el;
          }}
          role="tabpanel"
          id={`builder-tabpanel-${key}`}
          aria-labelledby={`builder-tab-${key}`}
          hidden={panelTab !== key || drilled}
          onScroll={(e) => {
            if (panelTab === key && !drilled) savedScroll.current[key] = e.currentTarget.scrollTop;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid={`builder-list-${key}`}
        >
          {key === "sections" ? <SectionTree editor={editor} /> : <EntryList editor={editor} tab={key} />}
        </div>
      ))}

      {sectionDrill && selection && (
        <DrillIn editor={editor} meta={nodeMeta(editor, selection)} onBack={editor.requestDrillBack}>
          {selection.kind !== "announcement" && <ContentBlocks editor={editor} selection={selection} />}
          <section aria-label="Settings">
            <GroupHeading>{selection.kind === "announcement" ? "Bar" : "Settings"}</GroupHeading>
            <NodeSettingsBody editor={editor} />
          </section>
        </DrillIn>
      )}

      {entryDrill && (
        <DrillIn editor={editor} meta={entryMeta(entryDrill)} onBack={editor.requestDrillBack}>
          <section aria-label="Settings">
            <GroupHeading>Settings</GroupHeading>
            <EntrySettingsBody editor={editor} entry={entryDrill} />
          </section>
          <p className="pt-4 text-xs text-text-faint">{APPLICABLE_NOTE}</p>
        </DrillIn>
      )}
    </div>
  );
}
