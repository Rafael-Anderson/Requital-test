"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { buildSearchIndex, searchSettings, type BuilderContext, type SearchEntry } from "@/lib/theme-builder-registry";

// The theme builder's "Search settings" box. It searches the WHOLE builder (every panel, section
// and layout entry), not just the panel that happens to be open. The index comes from the same
// central registry that decides which entries exist for this shop (lib/theme-builder-registry.ts),
// so an entry that does nothing for the shop's mode is never found. Results are a grouped list:
// the parent area as a group header, then each matching setting with a one-line description.
// Arrow keys move, Enter opens, Escape clears. Opening a result switches to the right tab or
// section and scrolls to, then briefly highlights, the setting (editor.goToSetting).

const EMPTY_CONTEXT: BuilderContext = { sectionsMode: false, sectionTypesPresent: new Set() };

type SearchEditor = {
  settingsSearchQuery: string;
  setSettingsSearchQuery: (q: string) => void;
  builderContext?: BuilderContext;
  goToSetting?: (target: SearchEntry["target"], settingLabel?: string) => void;
};

export default function BuilderSettingsSearch({ editor }: { editor: SearchEditor }) {
  const { settingsSearchQuery: query, setSettingsSearchQuery: setQuery, goToSetting } = editor;
  const ctx = editor.builderContext ?? EMPTY_CONTEXT;
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Rebuilt when the shop's mode or the theme's section types change, not per keystroke.
  const sectionKey = [...ctx.sectionTypesPresent].sort().join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => buildSearchIndex(ctx), [ctx.sectionsMode, sectionKey]);
  const groups = useMemo(() => searchSettings(index, query), [index, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(entry: SearchEntry) {
    goToSetting?.(entry.target, entry.settingLabel);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      if (flat[active]) {
        e.preventDefault();
        choose(flat[active]);
      }
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  }

  let flatIndex = -1;
  return (
    <div ref={rootRef} className="relative ms-auto w-56">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open && hasQuery}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${listId}-${flat[active].id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search settings..."
        className="h-8 w-full rounded-lg border border-black/10 bg-surface ps-8 pe-8 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 dark:border-white/15 dark:bg-zinc-900"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setOpen(false);
          }}
          aria-label="Clear search"
          className="absolute end-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && hasQuery && (
        <div
          id={listId}
          role="listbox"
          aria-label="Matching settings"
          className="absolute end-0 top-full z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-lg dark:border-white/15 dark:bg-zinc-900"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-zinc-500">No settings match</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} role="group" aria-label={g.group} className="pb-1">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{g.group}</p>
                {g.entries.map((entry) => {
                  flatIndex += 1;
                  const isActive = flatIndex === active;
                  return (
                    <button
                      key={entry.id}
                      id={`${listId}-${entry.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(flat.indexOf(entry))}
                      onClick={() => choose(entry)}
                      className={`block w-full rounded-lg px-2.5 py-1.5 text-start ${
                        isActive ? "bg-accent/10" : "hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{entry.label}</span>
                      <span className="block truncate text-xs text-zinc-500">{entry.description}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
