"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";

// Contenteditable "Text" field for the rich_text section's text block —
// replaces a plain <Textarea> so a merchant can select a run of text and
// apply bold/italic/underline via a small floating toolbar (Google Docs/
// Notion-style), rather than only ever storing/rendering plain text. The
// value stored (and posted to the preview) is the element's innerHTML, not
// plain text, so <strong>/<em>/<u> survive — see RichTextSection.tsx
// (storefront), which now renders it via dangerouslySetInnerHTML.
//
// Deliberately uncontrolled: `value` is only pushed into the DOM when
// `blockId` changes (switching to a different block), never on every
// keystroke's own onUpdate call — syncing innerHTML from React on every
// render would reset the caret position mid-typing. document.execCommand
// is deprecated but has no replacement with equivalent contenteditable
// browser support today, and every other rich-text-free part of this app
// already avoids pulling in a real editor library for a single field (see
// RichTextEditor.tsx's own note); this stays consistent with that.
export default function RichTextBlockEditor({
  blockId,
  value,
  onChange,
  label = "Text",
}: {
  blockId: string;
  value: string;
  onChange: (html: string) => void;
  label?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const syncedBlockId = useRef<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (syncedBlockId.current === blockId) return;
    syncedBlockId.current = blockId;
    if (editorRef.current) editorRef.current.innerHTML = value;
  }, [blockId, value]);

  function updateToolbarFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setToolbarPos(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const editor = editorRef.current;
    if (!editor || !editor.contains(range.commonAncestorContainer)) {
      setToolbarPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbarPos(null);
      return;
    }
    setToolbarPos({ top: rect.top, left: rect.left + rect.width / 2 });
  }

  useEffect(() => {
    document.addEventListener("selectionchange", updateToolbarFromSelection);
    return () => document.removeEventListener("selectionchange", updateToolbarFromSelection);
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (editorRef.current?.contains(target) || toolbarRef.current?.contains(target)) return;
      setToolbarPos(null);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  function applyFormat(command: "bold" | "italic" | "underline") {
    editorRef.current?.focus();
    document.execCommand(command);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</label>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onMouseUp={updateToolbarFromSelection}
        onKeyUp={updateToolbarFromSelection}
        className="min-h-24 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20"
      />
      {toolbarPos && (
        <div
          ref={toolbarRef}
          style={{ position: "fixed", top: toolbarPos.top - 44, left: toolbarPos.left, transform: "translateX(-50%)" }}
          className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg dark:border-white/10 dark:bg-zinc-900"
        >
          <button
            type="button"
            aria-label="Bold"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat("bold")}
            className="rounded p-1.5 text-[13px] font-bold text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10"
          >
            <Bold className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat("italic")}
            className="rounded p-1.5 text-[13px] font-bold text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10"
          >
            <Italic className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Underline"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat("underline")}
            className="rounded p-1.5 text-[13px] font-bold text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10"
          >
            <Underline className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
