"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import ColorPicker from "@/components/ui/ColorPicker";
import Button from "@/components/ui/Button";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import AnnouncementBarChromeSettings from "./AnnouncementBarChromeSettings";
import LegacyHeaderSettings from "../LegacyHeaderSettings";
import { BLOCK_TYPE_LABELS, type AnnouncementBarConfig, type HeaderRow, type ThemeBlock } from "@/lib/types";

// Header is global chrome (pinned to every page, not part of the
// reorderable sections list). Its logo/menu/search/cart/account blocks are
// edited by expanding the Header node in the tree; this panel holds
// header-level settings plus (Phase 3) the optional multi-row layout.
export default function HeaderSettings({
  settings,
  blocks,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  blocks: ThemeBlock[];
  onUpdate: (key: string, value: unknown) => void;
}) {
  const rows: HeaderRow[] = Array.isArray(settings.rows) ? (settings.rows as HeaderRow[]) : [];
  const blockLabel = (id: string) => {
    const b = blocks.find((x) => x.id === id);
    return b ? (BLOCK_TYPE_LABELS[b.type] ?? b.type) : "(removed block)";
  };
  const assignedIds = new Set(rows.flatMap((r) => r.blockIds ?? []));
  const unassigned = blocks.filter((b) => !assignedIds.has(b.id));

  function commitRows(next: HeaderRow[]) {
    // Always an array (never undefined) — an empty array reads as "no rows"
    // on both sides (storefront resolveHeaderRows returns null for []).
    onUpdate("rows", next);
  }
  function addRow() {
    commitRows([...rows, { id: `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, blockIds: [], align: "left" }]);
  }
  function updateRow(i: number, patch: Partial<HeaderRow>) {
    commitRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    commitRows(rows.filter((_, idx) => idx !== i));
  }
  function moveRow(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= rows.length) return;
    const next = [...rows];
    [next[i], next[t]] = [next[t], next[i]];
    commitRows(next);
  }
  function addBlockToRow(i: number, blockId: string) {
    if (!blockId) return;
    updateRow(i, { blockIds: [...(rows[i].blockIds ?? []), blockId] });
  }
  function removeBlockFromRow(i: number, blockId: string) {
    updateRow(i, { blockIds: (rows[i].blockIds ?? []).filter((id) => id !== blockId) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sticky header</span>
        <Toggle checked={!!settings.sticky} onChange={(v) => onUpdate("sticky", v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Transparent over hero</span>
        <Toggle checked={!!settings.transparentOnHero} onChange={(v) => onUpdate("transparentOnHero", v)} />
      </div>

      <Select
        label="Menu animation"
        value={(settings.menuAnimation as string) ?? "fade"}
        onChange={(e) => onUpdate("menuAnimation", e.target.value)}
      >
        <option value="fade">Fade</option>
        <option value="slide">Slide down</option>
        <option value="none">None</option>
      </Select>

      <hr className="border-black/10 dark:border-white/10" />

      {/* Phase 3 — optional multi-row header layout (contact bar above, etc.).
          With no rows the storefront renders its default single-row header
          unchanged. */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">Header rows</span>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="mr-1 size-3.5" /> Add row
          </Button>
        </div>
        <p className="mb-2 text-xs text-zinc-500">
          Group header blocks into stacked rows (a contact bar above the logo row, a centred nav row, and so on). Add
          blocks to the header from the tree first, then place them here. Blocks left unplaced fall into the last row.
        </p>

        {rows.length === 0 ? (
          <p className="text-xs text-zinc-400">No rows — the header renders as one row.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.id} className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                <div className="flex items-center gap-1">
                  <Select
                    aria-label="Row alignment"
                    value={row.align ?? "left"}
                    onChange={(e) => updateRow(i, { align: e.target.value as HeaderRow["align"] })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                    <option value="between">Space between</option>
                  </Select>
                  <ColorPicker
                    value={row.background ?? "#ffffff"}
                    onChange={(hex) => updateRow(i, { background: hex })}
                  />
                  {row.background && (
                    <button type="button" onClick={() => updateRow(i, { background: undefined })} className="text-xs text-zinc-400 hover:text-zinc-700">
                      clear
                    </button>
                  )}
                  <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label="Move row up" className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label="Move row down" className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => removeRow(i)} aria-label="Remove row" className="p-1 text-zinc-400 hover:text-red-600">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(row.blockIds ?? []).map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded bg-black/[0.04] px-2 py-0.5 text-xs dark:bg-white/[0.06]">
                      {blockLabel(id)}
                      <button type="button" onClick={() => removeBlockFromRow(i, id)} aria-label={`Remove ${blockLabel(id)} from row`} className="text-zinc-400 hover:text-red-600">
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {unassigned.length > 0 && (
                    <select
                      aria-label="Add block to row"
                      value=""
                      onChange={(e) => addBlockToRow(i, e.target.value)}
                      className="h-7 rounded border border-border bg-surface px-2 text-xs outline-none dark:border-white/15 dark:bg-zinc-900"
                    >
                      <option value="">+ add block…</option>
                      {unassigned.map((b) => (
                        <option key={b.id} value={b.id}>
                          {BLOCK_TYPE_LABELS[b.type] ?? b.type}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <AnnouncementBarChromeSettings
        value={settings.announcementBar as AnnouncementBarConfig | undefined}
        onChange={(v) => onUpdate("announcementBar", v)}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls value={settings.typography as TypographyValue} onChange={(v) => onUpdate("typography", v)} />
      <BackgroundControls value={settings.background as BackgroundValue} onChange={(v) => onUpdate("background", v)} />

      <hr className="border-black/10 dark:border-white/10" />

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Menu bar background</span>
          <ColorPicker
            value={(settings.menuBarBackground as string) ?? "#ffffff"}
            onChange={(hex) => onUpdate("menuBarBackground", hex)}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          The navigation row beneath the header. Falls back to the header background above if not set.
        </p>
      </div>

      <LegacyHeaderSettings />
    </div>
  );
}
