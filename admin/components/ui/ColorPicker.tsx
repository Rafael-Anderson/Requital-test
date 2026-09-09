"use client";

// Full replacement for the plain <input type="color"> swatch (see git
// history of ColorInput.tsx for the old approach) — same call-site contract
// (`value`/`onChange(hex)`) so every existing usage (Theme Customizer) swaps
// in without touching its own state logic. Popover-anchored to the swatch
// button, not inline, per the design brief. Hex-only (no alpha) because
// every field this feeds (ThemeSettings.colors, brandColor, secondaryColor)
// is stored as a plain 6-digit hex string, never rgba — see
// THEME_COLOR_FIELDS / getReadableTextColor in lib/types.ts and
// lib/color-contrast.ts, both of which only ever accept "#rrggbb".
import { useEffect, useId, useRef, useState } from "react";
import Tooltip from "./Tooltip";

interface ColorPickerProps {
  // Widened from `string` — see normalizeHex's own comment on why a
  // genuinely undefined value can still reach this component at runtime.
  value: string | undefined | null;
  onChange: (hex: string) => void;
  swatchSize?: "sm" | "md";
  className?: string;
  // Which edge of the swatch the popover is pinned to. Default "right"
  // (popover extends left) suits a control at the right edge of a settings
  // panel — every existing call site. "left" (extends right) is for a
  // swatch near the left edge, e.g. the rich-text toolbar.
  align?: "left" | "right";
  // Optional swatch row pinned to the top of the popover — the theme's own
  // scheme colours, so "make this run of text my brand colour" is one
  // click. Absent ⇒ no preset row, every existing call site unchanged.
  presets?: { label: string; value: string }[];
}

const SWATCH_SIZE_CLASS: Record<NonNullable<ColorPickerProps["swatchSize"]>, string> = {
  sm: "size-7",
  md: "size-8",
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

// Recent colours are shared across every ColorPicker in the admin (one
// merchant per browser session), persisted so a merchant's palette
// survives a reload. Best-effort: a private window / blocked storage just
// means no history, never a crash.
const RECENT_KEY = "requital_admin_recent_colors";
const RECENT_MAX = 8;
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && HEX_RE.test(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(hex: string): string[] {
  const next = [hex, ...readRecent().filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — history just won't persist */
  }
  return next;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function normalizeHex(hex: string | undefined | null): string | null {
  // A theme.config category added after a given theme row was last saved
  // can still be missing this field entirely at read time, despite the
  // backend's own backfill pass (see themes.service.ts's deepMergeDefaults)
  // — every category's own default is applied there, but a value this
  // component is handed could still be undefined for as long as an old,
  // un-migrated theme row exists. Guard here, the one place every call site
  // (useState init, the derived safeHex, commitHexDraft) already funnels
  // through, rather than requiring every caller to remember its own ?? "".
  if (!hex) return null;
  const trimmed = hex.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const expanded =
    /^#[0-9a-f]{3}$/i.test(withHash)
      ? `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`
      : withHash;
  return HEX_RE.test(expanded) ? expanded.toLowerCase() : null;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toByte = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function SwatchRow({
  label,
  colors,
  onPick,
  className = "",
}: {
  label: string;
  colors: { label: string; value: string }[];
  onPick: (hex: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-medium text-zinc-500">{label}</p>
      <div className="grid grid-cols-8 gap-1">
        {colors.map((c, i) => (
          <button
            key={`${c.value}-${i}`}
            type="button"
            title={c.label}
            aria-label={c.label}
            onClick={() => onPick(c.value)}
            className="size-5 rounded border border-black/15 dark:border-white/20 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            style={{ background: c.value }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ColorPicker({ value, onChange, swatchSize = "md", className = "", presets, align = "right" }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [hexDraft, setHexDraft] = useState(value);
  // Resets the editable draft whenever `value` changes from outside (a
  // spectrum/hue drag, or the parent resetting the field) without clobbering
  // in-progress typing — value only changes externally since onChange isn't
  // called until blur/enter commits the draft. Adjusting state during render
  // in response to a prop change, not in an effect, per React's own guidance
  // for this exact case (avoids the extra render an effect-based sync causes).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setHexDraft(value);
  }
  // Re-read the persisted recent list each time the popover opens (another
  // ColorPicker on the page may have pushed to it). Adjusted during render
  // on the open transition, not in an effect — same pattern as hexDraft
  // above, avoids the extra render an effect-based sync causes.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setRecent(readRecent());
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<null | "sv" | "hue">(null);
  const panelId = useId();

  const safeHex = normalizeHex(value) ?? "#000000";
  const { h, s, v } = hexToHsv(safeHex);

  // A deliberate pick (a preset/recent swatch, a committed hex, the end of
  // a spectrum/hue drag) goes into history; a mid-drag value does not.
  function remember(hex: string) {
    const normalized = normalizeHex(hex);
    if (normalized) setRecent(pushRecent(normalized));
  }

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function commitHexDraft() {
    const normalized = normalizeHex(hexDraft);
    if (normalized) {
      onChange(normalized);
      remember(normalized);
    } else setHexDraft(value);
  }

  function pickSwatch(hex: string) {
    onChange(hex);
    remember(hex);
  }

  function setFromSvEvent(clientX: number, clientY: number) {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ns = clamp01((clientX - rect.left) / rect.width);
    const nv = clamp01(1 - (clientY - rect.top) / rect.height);
    onChange(hsvToHex(h, ns, nv));
  }

  function setFromHueEvent(clientX: number, track: HTMLDivElement) {
    const rect = track.getBoundingClientRect();
    const nh = clamp01((clientX - rect.left) / rect.width) * 360;
    onChange(hsvToHex(nh, s, v));
  }

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      if (draggingRef.current === "sv") setFromSvEvent(e.clientX, e.clientY);
    }
    function handleUp() {
      if (draggingRef.current === "sv") remember(normalizeHex(value) ?? "#000000");
      draggingRef.current = null;
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h]);

  return (
    <div className={`relative inline-block ${className}`} ref={rootRef}>
      <Tooltip label="Choose a color">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Pick color, currently ${safeHex}`}
          className={`${SWATCH_SIZE_CLASS[swatchSize]} shrink-0 rounded-md border border-black/15 dark:border-white/30 cursor-pointer transition-shadow outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30`}
          style={{ background: safeHex }}
        />
      </Tooltip>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Color picker"
          className={`popover-in absolute ${align === "left" ? "left-0" : "right-0"} top-full z-50 mt-2 w-56 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg shadow-black/10 p-3`}
        >
          {presets && presets.length > 0 && (
            <SwatchRow label="Theme colors" colors={presets} onPick={pickSwatch} className="mb-2" />
          )}
          {recent.length > 0 && (
            <SwatchRow
              label="Recent"
              colors={recent.map((c) => ({ label: c, value: c }))}
              onPick={pickSwatch}
              className="mb-3"
            />
          )}

          {/* Saturation/value spectrum for the current hue */}
          <div
            ref={svRef}
            onMouseDown={(e) => {
              draggingRef.current = "sv";
              setFromSvEvent(e.clientX, e.clientY);
            }}
            className="relative h-32 w-full rounded-md cursor-crosshair"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`,
            }}
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuenow={Math.round(v * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = 0.02;
              if (e.key === "ArrowRight") onChange(hsvToHex(h, clamp01(s + step), v));
              if (e.key === "ArrowLeft") onChange(hsvToHex(h, clamp01(s - step), v));
              if (e.key === "ArrowUp") onChange(hsvToHex(h, s, clamp01(v + step)));
              if (e.key === "ArrowDown") onChange(hsvToHex(h, s, clamp01(v - step)));
            }}
          >
            <div
              className="absolute size-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: safeHex }}
            />
          </div>

          {/* Hue slider */}
          <div
            className="relative h-3 w-full rounded-full cursor-pointer mt-3"
            style={{
              background:
                "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
            role="slider"
            aria-label="Hue"
            aria-valuenow={Math.round(h)}
            aria-valuemin={0}
            aria-valuemax={360}
            tabIndex={0}
            onMouseDown={(e) => {
              const track = e.currentTarget;
              setFromHueEvent(e.clientX, track);
              function handleMove(ev: MouseEvent) {
                setFromHueEvent(ev.clientX, track);
              }
              function handleUp() {
                window.removeEventListener("mousemove", handleMove);
                window.removeEventListener("mouseup", handleUp);
                remember(normalizeHex(value) ?? "#000000");
              }
              window.addEventListener("mousemove", handleMove);
              window.addEventListener("mouseup", handleUp);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onChange(hsvToHex((h + 2) % 360, s, v));
              if (e.key === "ArrowLeft") onChange(hsvToHex((h - 2 + 360) % 360, s, v));
            }}
          >
            <div
              className="absolute top-1/2 size-4 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h}, 100%, 50%)` }}
            />
          </div>

          {/* Hex input + live preview */}
          <div className="flex items-center gap-2 mt-3">
            <div
              className="size-8 shrink-0 rounded-md border border-black/15 dark:border-white/15"
              style={{ background: safeHex }}
            />
            <input
              value={hexDraft ?? ""}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={commitHexDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitHexDraft();
                }
              }}
              spellCheck={false}
              aria-label="Hex color value"
              className="flex h-8 w-full min-w-0 rounded-md border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-xs font-mono shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            />
          </div>
        </div>
      )}
    </div>
  );
}
