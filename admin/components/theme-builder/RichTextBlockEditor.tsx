"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  RemoveFormatting,
  Baseline,
} from "lucide-react";

// Rich-text field for a theme text block (the rich_text section's "text"
// block and, since #16, the image_text section's). A real WYSIWYG (TipTap /
// ProseMirror, headless) so a merchant can select a run of text and change
// its COLOUR / SIZE / FONT / style — not just the whole block. The stored
// value is the editor's HTML; the storefront renders it via
// sanitizeDescriptionHtml (see lib/sanitize-html.ts, whose inline-style
// allowlist is scoped to exactly what this toolbar emits: colour /
// font-size / font-family / text-align).
//
// Same prop contract as the old contenteditable version so every call site
// (ElementSettingsPanel, AdditionalInfoSection, CollectionPageSettings) is
// unchanged. `value` is pushed into the editor only when `blockId` changes,
// never on every keystroke, so the caret is never reset mid-typing.

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px"];
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans", value: "'Helvetica Neue', Arial, sans-serif" },
  { label: "Mono", value: "'SFMono-Regular', Menlo, monospace" },
  { label: "Playfair", value: "'Playfair Display', serif" },
];

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10 ${
        active ? "bg-black/10 dark:bg-white/15" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const colorRef = useRef<HTMLInputElement>(null);
  // Subscribe to selection/transaction changes so active states re-render.
  const tick = editor.state.selection.from + editor.state.selection.to + editor.state.doc.content.size;
  void tick;

  const iconCls = "size-4";
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-[10px] border border-b-0 border-border bg-surface p-1 dark:border-white/15 dark:bg-zinc-900">
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className={iconCls} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border dark:bg-white/15" />

      <ToolbarButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className={iconCls} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border dark:bg-white/15" />

      <ToolbarButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className={iconCls} />
      </ToolbarButton>
      <ToolbarButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className={iconCls} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border dark:bg-white/15" />

      {/* Colour — a real per-selection <span style="color"> mark. */}
      <button
        type="button"
        aria-label="Text color"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => colorRef.current?.click()}
        className="relative rounded p-1.5 text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10"
      >
        <Baseline className={iconCls} />
        <input
          ref={colorRef}
          type="color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </button>

      <select
        aria-label="Font size"
        value={(editor.getAttributes("textStyle").fontSize as string) || ""}
        onChange={(e) =>
          e.target.value
            ? editor.chain().focus().setFontSize(e.target.value).run()
            : editor.chain().focus().unsetFontSize().run()
        }
        className="rounded border border-border bg-surface px-1.5 py-1 text-xs dark:border-white/15 dark:bg-zinc-900"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s.replace("px", "")}
          </option>
        ))}
      </select>

      <select
        aria-label="Font family"
        value={(editor.getAttributes("textStyle").fontFamily as string) || ""}
        onChange={(e) =>
          e.target.value
            ? editor.chain().focus().setFontFamily(e.target.value).run()
            : editor.chain().focus().unsetFontFamily().run()
        }
        className="rounded border border-border bg-surface px-1.5 py-1 text-xs dark:border-white/15 dark:bg-zinc-900"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <span className="mx-1 h-5 w-px bg-border dark:bg-white/15" />

      <ToolbarButton
        label="Add link"
        active={editor.isActive("link")}
        onClick={() => {
          const prev = (editor.getAttributes("link").href as string) || "";
          const url = window.prompt("Link URL", prev);
          if (url === null) return;
          if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        <Link2 className={iconCls} />
      </ToolbarButton>
      <ToolbarButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className={iconCls} />
      </ToolbarButton>
    </div>
  );
}

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
  const syncedBlockId = useRef<string | null>(null);

  const editor = useEditor({
    // Next 16 / RSC — render on the client only to avoid a hydration mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "min-h-24 w-full rounded-b-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_a]:underline",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Push external `value` in only when the selected block actually changes
  // (never on every keystroke's own onChange round-trip).
  useEffect(() => {
    if (!editor || syncedBlockId.current === blockId) return;
    syncedBlockId.current = blockId;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, blockId, value]);

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</label>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
