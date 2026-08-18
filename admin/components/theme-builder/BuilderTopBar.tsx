"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Redo2, Undo2 } from "lucide-react";
import Button from "@/components/ui/Button";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Tooltip from "@/components/ui/Tooltip";
import { updateThemeDraft } from "@/lib/api";
import type { ThemeEditorState, DevicePreview } from "@/lib/useThemeEditor";

export default function BuilderTopBar({ editor }: { editor: ThemeEditorState }) {
  const { theme, device, setDevice, dirty, saving, publishing, publish, discard, undo, redo, canUndo, canRedo } = editor;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  if (!theme) return null;

  async function commitName(themeId: number, currentName: string) {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentName) return;
    await updateThemeDraft(themeId, { name: trimmed });
  }

  return (
    <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/theme" className="text-text-faint hover:text-accent-text dark:hover:text-zinc-300">
          <ArrowLeft className="size-4" />
        </Link>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void commitName(theme.id, theme.name)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="rounded-[10px] border border-border px-2 py-1 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(theme.name);
              setEditingName(true);
            }}
            className="truncate text-sm font-bold text-text-primary hover:underline dark:text-zinc-50"
          >
            {theme.name}
          </button>
        )}
        {saving && <span className="shrink-0 text-xs text-text-faint">Saving…</span>}
      </div>

      <SegmentedToggle<DevicePreview>
        value={device}
        options={[
          { value: "desktop", label: "Desktop" },
          { value: "tablet", label: "Tablet" },
          { value: "mobile", label: "Mobile" },
        ]}
        onChange={setDevice}
      />

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 mr-1">
          <Tooltip label="Undo (Ctrl+Z)">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
              className="flex items-center justify-center size-8 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <Undo2 className="size-4" />
            </button>
          </Tooltip>
          <Tooltip label="Redo (Ctrl+Shift+Z)">
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              className="flex items-center justify-center size-8 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <Redo2 className="size-4" />
            </button>
          </Tooltip>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void discard()} disabled={!dirty}>
          Discard
        </Button>
        <Button variant="primary" size="sm" loading={publishing} onClick={() => void publish()}>
          Publish
        </Button>
      </div>
    </div>
  );
}
