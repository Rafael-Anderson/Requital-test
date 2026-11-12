"use client";

import { Plus, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import ColorPicker from "@/components/ui/ColorPicker";
import RichTextBlockEditor from "../RichTextBlockEditor";
import MarqueeSpeedControl from "./shared/MarqueeSpeedControl";
import type { AnnouncementBarConfig } from "@/lib/types";

// The Sections tab's "Announcement bar": the ONE place the persistent bar above the header is
// edited (it used to be split across the Header panel, a homepage "Announcement Bar" section's
// classic sub-panel and the old Site Settings page). Stored at header.settings.announcementBar;
// the editor marks it `managed`, which makes Off mean no bar at all on the storefront.
// Order is deliberate: On/Off, the text, then Speed directly under the text.
export default function AnnouncementBarChromeSettings({
  value,
  onChange,
  colorPresets,
  position,
  onPositionChange,
}: {
  value: AnnouncementBarConfig | undefined;
  onChange: (next: AnnouncementBarConfig) => void;
  colorPresets?: { label: string; value: string }[];
  // header.settings.announcementPosition ("above" | "below"); omitted = control not shown.
  position?: string;
  onPositionChange?: (next: string) => void;
}) {
  const cfg: AnnouncementBarConfig = value ?? { enabled: false, messages: [] };
  const messages = Array.isArray(cfg.messages) ? cfg.messages : [];
  const patch = (p: Partial<AnnouncementBarConfig>) => onChange({ ...cfg, ...p });
  const setMessages = (next: string[]) => patch({ messages: next });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Announcement bar</span>
        <Toggle checked={!!cfg.enabled} onChange={(v) => patch({ enabled: v })} />
      </div>
      <p className="text-xs text-zinc-500">
        A slim bar on every page, above the header. Off means the bar is not shown on your storefront at all.
      </p>

      {cfg.enabled && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm">Scrolling (marquee)</span>
            <Toggle checked={!!cfg.scrolling} onChange={(v) => patch({ scrolling: v })} />
          </div>

          <div className="space-y-2">
            {messages.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <div className="flex-1">
                  <RichTextBlockEditor
                    blockId={`chrome-announcement-${i}`}
                    label={`Message ${i + 1}`}
                    mode="inline"
                    value={m}
                    onChange={(html) => setMessages(messages.map((x, idx) => (idx === i ? html : x)))}
                    colorPresets={colorPresets}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setMessages(messages.filter((_, idx) => idx !== i))}
                  aria-label="Remove message"
                  className="mt-7 shrink-0 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setMessages([...messages, ""])}>
              <Plus className="me-1 size-3.5" /> Add message
            </Button>
          </div>

          {cfg.scrolling && <MarqueeSpeedControl value={cfg.marqueeSpeed} onChange={(v) => patch({ marqueeSpeed: v })} />}
          {!cfg.scrolling && messages.length > 1 && (
            <Select label="Rotation speed" value={cfg.speed ?? "medium"} onChange={(e) => patch({ speed: e.target.value as AnnouncementBarConfig["speed"] })}>
              <option value="fast">Fast</option>
              <option value="medium">Medium</option>
              <option value="slow">Slow</option>
            </Select>
          )}

          {onPositionChange && (
            <Select label="Announcement bar position" value={position ?? "above"} onChange={(e) => onPositionChange(e.target.value)}>
              <option value="above">Above header</option>
              <option value="below">Below header</option>
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
