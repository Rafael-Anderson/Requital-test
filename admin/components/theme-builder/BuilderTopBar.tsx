"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Monitor, PanelLeft, Redo2, Search, Smartphone, Tablet, Undo2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import BuilderSettingsSearch from "./BuilderSettingsSearch";
import { PreviewPageSelector } from "./PreviewFrame";
import { updateThemeDraft } from "@/lib/api";
import type { ThemeEditorState, DevicePreview } from "@/lib/useThemeEditor";

export const LEAVE_CONFIRM_MESSAGE =
  "You have changes that are not published yet. Leave the theme builder without publishing? Your draft is kept.";

const DEVICES: { value: DevicePreview; label: string; Icon: typeof Monitor }[] = [
  { value: "desktop", label: "Desktop", Icon: Monitor },
  { value: "tablet", label: "Tablet", Icon: Tablet },
  { value: "mobile", label: "Mobile", Icon: Smartphone },
];

// Text labels from xl up; icons (with the same accessible names) below, so the bar fits at 1024.
function DeviceToggle({ value, onChange }: { value: DevicePreview; onChange: (d: DevicePreview) => void }) {
  return (
    <div role="group" aria-label="Preview device" className="flex shrink-0 rounded-lg border border-border p-0.5 dark:border-white/15">
      {DEVICES.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          aria-label={label}
          title={label}
          className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors ${
            value === v ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"
          }`}
        >
          <Icon className="size-3.5 xl:hidden" aria-hidden />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  className = "",
  pressed,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  pressed?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        className={`flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10 ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export default function BuilderTopBar({
  editor,
  shopName,
  panelOpen,
  onTogglePanel,
}: {
  editor: ThemeEditorState;
  shopName: string;
  // Below 1024px the left panel is a drawer over the preview; this button opens and closes it.
  panelOpen?: boolean;
  onTogglePanel?: () => void;
}) {
  const { theme, device, setDevice, dirty, saving, publishing, publish, discard, undo, redo, canUndo, canRedo, previewPath, setPreviewPath } = editor;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focuses the global settings search (expanding it first on narrow screens).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setSearchExpanded(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!theme) return null;

  async function commitName(themeId: number, currentName: string) {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentName) return;
    await updateThemeDraft(themeId, { name: trimmed });
  }

  function confirmLeave(e: MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm(LEAVE_CONFIRM_MESSAGE)) e.preventDefault();
  }

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 dark:border-white/10 dark:bg-zinc-900 sm:px-3">
      {/* Start: back, shop and theme name, live/draft chip */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Tooltip label="Back to themes">
          <Link
            href="/theme"
            onClick={confirmLeave}
            aria-label="Back to themes"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
          </Link>
        </Tooltip>
        {onTogglePanel && (
          <IconButton label={panelOpen ? "Hide panel" : "Show panel"} onClick={onTogglePanel} pressed={panelOpen} className="lg:hidden">
            <PanelLeft className="size-4" />
          </IconButton>
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-text-primary dark:text-zinc-50">{shopName}</p>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              aria-label="Theme name"
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void commitName(theme.id, theme.name)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="h-5 w-40 rounded border border-border px-1 text-xs dark:border-white/15 dark:bg-zinc-900"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameDraft(theme.name);
                setEditingName(true);
              }}
              title="Rename theme"
              className="block max-w-full cursor-pointer truncate text-start text-xs leading-tight text-text-muted hover:underline"
            >
              {theme.name}
            </button>
          )}
        </div>
        <span
          className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${
            theme.isPublished ? "bg-accent-tint text-accent-text" : "bg-neutral-chip-bg text-text-muted"
          }`}
        >
          {theme.isPublished ? "Live theme" : "Draft"}
        </span>
      </div>

      {/* Centre: page selector and device */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <PreviewPageSelector previewPath={previewPath} setPreviewPath={setPreviewPath} />
        <DeviceToggle value={device} onChange={setDevice} />
      </div>

      {/* End: undo/redo, search, unsaved, discard, publish */}
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <div className="hidden items-center sm:flex">
          <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
            <Redo2 className="size-4" />
          </IconButton>
        </div>

        <BuilderSettingsSearch
          editor={editor}
          inputRef={searchRef}
          onDone={() => setSearchExpanded(false)}
          className={`${searchExpanded ? "block" : "hidden"} w-[240px] max-xl:absolute max-xl:end-2 max-xl:top-[calc(100%+4px)] max-xl:max-w-[calc(100vw-1rem)] xl:block`}
        />
        <IconButton
          label="Search settings (Ctrl+K)"
          onClick={() => {
            setSearchExpanded((v) => !v);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          pressed={searchExpanded}
          className="xl:hidden"
        >
          <Search className="size-4" />
        </IconButton>

        {(dirty || saving) && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-warning-text" role="status" title={saving ? "Saving" : "Unsaved changes"}>
            <span className="size-2 rounded-full bg-amber-500" aria-hidden />
            <span className="hidden xl:inline">{saving ? "Saving…" : "Unsaved"}</span>
            <span className="sr-only xl:hidden">{saving ? "Saving" : "Unsaved"}</span>
          </span>
        )}
        <span className="hidden sm:contents">
          <Button variant="secondary" size="sm" onClick={() => void discard()} disabled={!dirty}>
            Discard
          </Button>
        </span>
        <Button variant="primary" size="sm" loading={publishing} onClick={() => void publish()}>
          Publish
        </Button>
      </div>
    </header>
  );
}
