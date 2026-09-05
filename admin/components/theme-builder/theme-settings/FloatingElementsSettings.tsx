"use client";

import { Plus, Trash2 } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import type { FloatingElementsSettings as FloatingElementsSettingsType, FloatingCustomButton } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const DEFAULT: FloatingElementsSettingsType = {
  whatsapp: { enabled: false, position: "bottom_right" },
  customButtons: [],
  backToTop: { enabled: false },
};

function newButtonId(): string {
  return `fbtn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const FIELD_CLASS =
  "flex-1 h-9 rounded-[10px] border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 dark:border-white/15 dark:bg-zinc-900";

// Phase 6 (TBE7) — persistent overlay UI: the floating WhatsApp button and
// arbitrary "custom link buttons" (a rewards / chat launcher is a link-out,
// NOT an embedded third-party script). Its own theme-settings category since
// it isn't composed of sections. globalSettings.floatingElements is OPTIONAL
// so an older published theme reads as `undefined` here — hence the DEFAULT
// guard.
export default function FloatingElementsSettings({ editor }: { editor: ThemeEditorState }) {
  const settings = editor.config!.globalSettings.floatingElements ?? DEFAULT;
  const buttons = Array.isArray(settings.customButtons) ? settings.customButtons : [];

  function commit(patch: Partial<FloatingElementsSettingsType>) {
    editor.updateGlobalSettingsCategory("floatingElements", { ...DEFAULT, ...settings, ...patch });
  }
  function setButtons(next: FloatingCustomButton[]) {
    commit({ customButtons: next });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Floating WhatsApp button</span>
          <Toggle
            checked={!!settings.whatsapp?.enabled}
            onChange={(v) => commit({ whatsapp: { ...settings.whatsapp, enabled: v } })}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Uses the WhatsApp number from Business Information. Off ⇒ the legacy Store Configuration toggle still
          applies.
        </p>
        {settings.whatsapp?.enabled && (
          <Select
            label="Position"
            value={settings.whatsapp?.position ?? "bottom_right"}
            onChange={(e) => commit({ whatsapp: { ...settings.whatsapp, position: e.target.value as "bottom_right" | "bottom_left" } })}
          >
            <option value="bottom_right">Bottom right</option>
            <option value="bottom_left">Bottom left</option>
          </Select>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Back-to-top button</span>
          <Toggle
            checked={!!settings.backToTop?.enabled}
            onChange={(v) => commit({ backToTop: { enabled: v } })}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Appears once a visitor scrolls down. Fixed bottom-left corner, opposite the WhatsApp button&apos;s default
          side.
        </p>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">Custom link buttons</span>
        <p className="mb-2 text-xs text-zinc-500">
          A floating button that links out (loyalty program, live chat, a booking page). Link only, no embedded
          widgets.
        </p>
        <div className="space-y-2">
          {buttons.map((b, i) => (
            <div key={b.id} className="rounded-lg border border-black/10 p-2 dark:border-white/10">
              <div className="flex items-center gap-1.5">
                <input
                  aria-label="Button label"
                  placeholder="Rewards"
                  value={b.label}
                  onChange={(e) => setButtons(buttons.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                  className={FIELD_CLASS}
                />
                <button
                  type="button"
                  onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))}
                  aria-label="Remove button"
                  className="shrink-0 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <input
                aria-label="Button URL"
                placeholder="https://…"
                value={b.url}
                onChange={(e) => setButtons(buttons.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                className={`${FIELD_CLASS} mt-1.5 w-full`}
              />
              <Select
                label="Position"
                value={b.position ?? "bottom_right"}
                onChange={(e) => setButtons(buttons.map((x, idx) => (idx === i ? { ...x, position: e.target.value as "bottom_right" | "bottom_left" } : x)))}
              >
                <option value="bottom_right">Bottom right</option>
                <option value="bottom_left">Bottom left</option>
              </Select>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => setButtons([...buttons, { id: newButtonId(), label: "", url: "", position: "bottom_right" }])}
        >
          <Plus className="mr-1 size-3.5" /> Add button
        </Button>
      </div>
    </div>
  );
}
