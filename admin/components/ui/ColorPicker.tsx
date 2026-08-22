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
}

const SWATCH_SIZE_CLASS: Record<NonNullable<ColorPickerProps["swatchSize"]>, string> = {
  sm: "size-7",
  md: "size-8",
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

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

export default function ColorPicker({ value, onChange, swatchSize = "md", className = "" }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<null | "sv" | "hue">(null);
  const panelId = useId();

  const safeHex = normalizeHex(value) ?? "#000000";
  const { h, s, v } = hexToHsv(safeHex);

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
    if (normalized) onChange(normalized);
    else setHexDraft(value);
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
          className="popover-in absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg shadow-black/10 p-3"
        >
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
