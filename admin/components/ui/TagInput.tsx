"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

// Extracted from app/theme/edit/site-settings/page.tsx once a second call
// site (LegacyAnnouncementSettings.tsx) needed the same control — no longer
// premature to share. "Type a tag and press Tab" per the reference; Enter
// also works, since requiring literally Tab (which usually moves focus) is
// an odd UX expectation to hold a user to.
export default function TagInput({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commit();
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-black/15 dark:border-white/15 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 min-h-9 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/20">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs">
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="cursor-pointer text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? "Type a tag and press Tab" : ""}
        className="flex-1 min-w-24 bg-transparent text-sm outline-none px-1"
      />
    </div>
  );
}
