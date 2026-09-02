"use client";

import { Plus, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import ColorPicker from "@/components/ui/ColorPicker";
import type { AnnouncementBarConfig } from "@/lib/types";

// The PERSISTENT chrome announcement bar (theme-builder-expansion Phase 5,
// TBE3) — lives on header.settings.announcementBar, edited from within
// HeaderSettings. Distinct from the homepage-body `announcement_bar` section
// (AnnouncementBarSettings.tsx). Disabled / no messages ⇒ the storefront
// falls back to the legacy notification bar.
export default function AnnouncementBarChromeSettings({
  value,
  onChange,
}: {
  value: AnnouncementBarConfig | undefined;
  onChange: (next: AnnouncementBarConfig) => void;
}) {
  const cfg: AnnouncementBarConfig = value ?? { enabled: false, messages: [] };
  const messages = Array.isArray(cfg.messages) ? cfg.messages : [];
  const patch = (p: Partial<AnnouncementBarConfig>) => onChange({ ...cfg, ...p });
  const setMessages = (next: string[]) => patch({ messages: next });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Announcement bar</span>
        <Toggle checked={!!cfg.enabled} onChange={(v) => patch({ enabled: v })} />
      </div>
      <p className="text-xs text-zinc-500">
        A slim bar on every page, above the header. Off ⇒ the legacy notification bar (Business Information) still
        shows if it was set.
      </p>

      {cfg.enabled && (
        <>
          <div className="space-y-2">
            {messages.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  aria-label={`Message ${i + 1}`}
                  value={m}
                  onChange={(e) => setMessages(messages.map((x, idx) => (idx === i ? e.target.value : x)))}
                  placeholder="Free delivery on orders over AED 200 🚚"
                  className="flex-1 h-9 rounded-[10px] border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 dark:border-white/15 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => setMessages(messages.filter((_, idx) => idx !== i))}
                  aria-label="Remove message"
                  className="shrink-0 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setMessages([...messages, ""])}>
            <Plus className="mr-1 size-3.5" /> Add message
          </Button>

          <div className="flex items-center justify-between">
            <span className="text-sm">Scrolling (marquee)</span>
            <Toggle checked={!!cfg.scrolling} onChange={(v) => patch({ scrolling: v })} />
          </div>
          {!cfg.scrolling && messages.length > 1 && (
            <Select label="Rotation speed" value={cfg.speed ?? "medium"} onChange={(e) => patch({ speed: e.target.value as AnnouncementBarConfig["speed"] })}>
              <option value="fast">Fast</option>
              <option value="medium">Medium</option>
              <option value="slow">Slow</option>
            </Select>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm">Dismissible (X button)</span>
            <Toggle checked={!!cfg.dismissible} onChange={(v) => patch({ dismissible: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Background color</span>
            <div className="flex items-center gap-1">
              <ColorPicker value={cfg.background ?? "#069494"} onChange={(hex) => patch({ background: hex })} />
              {cfg.background && (
                <button type="button" onClick={() => patch({ background: undefined })} className="text-xs text-zinc-400 hover:text-zinc-700">
                  clear
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Text color</span>
            <div className="flex items-center gap-1">
              <ColorPicker value={cfg.textColor ?? "#ffffff"} onChange={(hex) => patch({ textColor: hex })} />
              {cfg.textColor && (
                <button type="button" onClick={() => patch({ textColor: undefined })} className="text-xs text-zinc-400 hover:text-zinc-700">
                  clear
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-400">Leave both colors cleared to use the shop accent.</p>
        </>
      )}
    </div>
  );
}
