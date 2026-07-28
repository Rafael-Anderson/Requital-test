"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, Heading2, List, ListOrdered, Link as LinkIcon } from "lucide-react";

// No rich-text/WYSIWYG library exists anywhere in this app (confirmed via
// search before building this) — a lightweight contentEditable +
// document.execCommand editor, not a new dependency, per the task's own
// "lightweight, not a heavy new dependency" instruction. execCommand is
// deprecated but still universally supported for exactly this kind of
// basic toolbar; the alternative (a hand-rolled selection/range model) is
// far more code for the same result.
interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
}

const BUTTONS = [
  { command: "bold", icon: Bold, label: "Bold" },
  { command: "italic", icon: Italic, label: "Italic" },
  { command: "underline", icon: Underline, label: "Underline" },
  { command: "formatBlock", value: "h2", icon: Heading2, label: "Heading" },
  { command: "insertUnorderedList", icon: List, label: "Bullet list" },
  { command: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
] as const;

export default function RichTextEditor({ label, value, onChange }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Tracks the last value we ourselves pushed via onChange, so an external
  // reset (e.g. loading a different product) re-syncs the DOM, but our own
  // keystrokes never get overwritten mid-edit — contentEditable + a fully
  // controlled innerHTML fights the cursor position otherwise.
  // Starts as null (never a real value) rather than useRef(value): callers
  // often mount this with the real content already in `value` (e.g. after
  // an async fetch resolves before first render, gated behind a loading
  // skeleton) — seeding lastEmitted with that same value would make the
  // very first sync see value === lastEmitted.current and skip writing to
  // innerHTML, leaving the contentEditable DOM empty despite correct state.
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  function exec(command: string, commandValue?: string) {
    ref.current?.focus();
    document.execCommand(command, false, commandValue);
    handleInput();
  }

  function handleInput() {
    const html = ref.current?.innerHTML ?? "";
    lastEmitted.current = html;
    onChange(html);
  }

  function handleLink() {
    const url = window.prompt("Link URL");
    if (url) exec("createLink", url);
  }

  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">{label}</label>
      <div className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 shadow-sm shadow-black/5 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/20 transition-shadow">
        <div className="flex items-center gap-0.5 border-b border-black/10 dark:border-white/10 p-1.5">
          {BUTTONS.map(({ command, icon: Icon, label: btnLabel, ...rest }) => (
            <button
              key={command + ("value" in rest ? rest.value : "")}
              type="button"
              title={btnLabel}
              aria-label={btnLabel}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(command, "value" in rest ? rest.value : undefined)}
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button
            type="button"
            title="Insert link"
            aria-label="Insert link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleLink}
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <LinkIcon className="size-4" />
          </button>
        </div>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          className="px-3 py-2 text-sm min-h-32 outline-none [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent-text [&_a]:underline"
        />
      </div>
    </div>
  );
}
