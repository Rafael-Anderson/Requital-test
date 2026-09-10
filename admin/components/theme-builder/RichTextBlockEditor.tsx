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
} from "lucide-react";
import ColorPicker from "@/components/ui/ColorPicker";

// Rich-text field for a theme text block. A real WYSIWYG (TipTap /
// ProseMirror, headless) so a merchant can select a run of text and change
// its COLOUR / SIZE / FONT / style — not just the whole block. The stored
// value is the editor's HTML; the storefront renders it via
// sanitizeDescriptionHtml (see lib/sanitize-html.ts, whose inline-style
// allowlist is scoped to exactly what this toolbar emits: colour /
// font-size / font-family / text-align).
//
// Two modes, one implementation (Phase 2 of the rich-text rollout):
//   "full"   — body prose. Full 2-row toolbar (formatting / headings /
//              lists / alignment / colour / size / font / link). Stores
//              block HTML (<p>…</p><ul>…). Rendered into a <div> wrapper.
//   "inline" — headings and one-line body. Constrained toolbar
//              (bold / italic / underline / strike · colour · link · clear),
//              NO headings-in-headings, NO lists, NO block alignment, and
//              single-line enforced (Enter is a no-op, newlines are
//              stripped on paste). Stores BARE inline HTML (`Welcome
//              <strong>our</strong> store` — the outer <p> the editor
//              schema needs is stripped in onChange), so the storefront can
//              drop it straight inside the existing <h2>/<p> tag without
//              invalid nesting. A legacy plain-text value round-trips
//              byte-identical (ProseMirror wraps loose text in a paragraph
//              on load; strip removes it again on save).
//
// Same prop contract as the old contenteditable version so every call site
// is unchanged. `value` is pushed into the editor only when `blockId`
// changes, never on every keystroke, so the caret is never reset mid-typing.

type EditorMode = "full" | "inline";

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px"];
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans", value: "'Helvetica Neue', Arial, sans-serif" },
  { label: "Mono", value: "'SFMono-Regular', Menlo, monospace" },
  { label: "Playfair", value: "'Playfair Display', serif" },
];

// The editor schema still needs a top-level block, so "inline" mode content
// is a single <p>. Strip that one wrapper on the way out so the stored
// value is bare inline HTML. Only unwraps a lone paragraph — if a paste
// somehow produced more (it can't: Enter is blocked, block nodes are
// disabled), the value is left intact rather than silently flattened.
// Exported for unit testing.
export function stripOuterParagraph(html: string): string {
  const m = html.match(/^\s*<p>([\s\S]*)<\/p>\s*$/i);
  if (m && !/<(p|div|ul|ol|li|h[1-6])[\s>]/i.test(m[1])) return m[1];
  return html;
}

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
      className={`rounded p-1 text-text-primary hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10 ${
        active ? "bg-black/10 dark:bg-white/15" : ""
      }`}
    >
      {children}
    </button>
  );
}

// A logical toolbar group — never splits across a wrap boundary, so when
// the panel is too narrow for a full row the break always falls cleanly
// between groups (not mid-group). The leading divider travels with it.
function Group({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div className="flex flex-nowrap items-center gap-0.5">
      {!first && <span className="mx-0.5 h-5 w-px shrink-0 bg-border dark:bg-white/15" />}
      {children}
    </div>
  );
}

const SELECT_CLS =
  "rounded border border-border bg-surface px-1 py-1 text-xs dark:border-white/15 dark:bg-zinc-900";
const ICON_CLS = "size-4";

function FormattingGroup({ editor }: { editor: Editor }) {
  return (
    <Group first>
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className={ICON_CLS} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className={ICON_CLS} />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className={ICON_CLS} />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className={ICON_CLS} />
      </ToolbarButton>
    </Group>
  );
}

function ColorControl({ editor, colorPresets }: { editor: Editor; colorPresets?: { label: string; value: string }[] }) {
  const currentColor = (editor.getAttributes("textStyle").color as string) || "#000000";
  return (
    <ColorPicker
      value={currentColor}
      onChange={(hex) => editor.chain().focus().setColor(hex).run()}
      presets={colorPresets}
      swatchSize="sm"
      align="left"
    />
  );
}

function LinkClearGroup({ editor }: { editor: Editor }) {
  return (
    <Group>
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
        <Link2 className={ICON_CLS} />
      </ToolbarButton>
      <ToolbarButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className={ICON_CLS} />
      </ToolbarButton>
    </Group>
  );
}

function Toolbar({
  editor,
  mode,
  colorPresets,
}: {
  editor: Editor;
  mode: EditorMode;
  colorPresets?: { label: string; value: string }[];
}) {
  // Subscribe to selection/transaction changes so active states re-render.
  const tick = editor.state.selection.from + editor.state.selection.to + editor.state.doc.content.size;
  void tick;

  if (mode === "inline") {
    // One compact row: formatting · colour · link / clear. No headings,
    // lists, or alignment — this field renders as a heading or a single
    // line of body text, not a paragraph editor.
    return (
      <div className="flex flex-wrap items-center gap-1 rounded-t-[10px] border border-b-0 border-border bg-surface p-1 dark:border-white/15 dark:bg-zinc-900">
        <FormattingGroup editor={editor} />
        <ColorControl editor={editor} colorPresets={colorPresets} />
        <LinkClearGroup editor={editor} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-t-[10px] border border-b-0 border-border bg-surface p-1 dark:border-white/15 dark:bg-zinc-900">
      {/* Row 1 — text formatting · headings · lists · alignment. Groups
          never split; a too-narrow panel breaks between them, not inside. */}
      <div className="flex flex-wrap items-center gap-y-1">
        <FormattingGroup editor={editor} />

        <Group>
          <ToolbarButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className={ICON_CLS} />
          </ToolbarButton>
          <ToolbarButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className={ICON_CLS} />
          </ToolbarButton>
          <ToolbarButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className={ICON_CLS} />
          </ToolbarButton>
        </Group>

        <Group>
          <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className={ICON_CLS} />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className={ICON_CLS} />
          </ToolbarButton>
        </Group>

        <Group>
          <ToolbarButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
            <AlignLeft className={ICON_CLS} />
          </ToolbarButton>
          <ToolbarButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
            <AlignCenter className={ICON_CLS} />
          </ToolbarButton>
          <ToolbarButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
            <AlignRight className={ICON_CLS} />
          </ToolbarButton>
        </Group>
      </div>

      {/* Row 2 — colour · size · font family · link · clear */}
      <div className="flex flex-wrap items-center gap-1">
        <ColorControl editor={editor} colorPresets={colorPresets} />

        <select
          aria-label="Font size"
          value={(editor.getAttributes("textStyle").fontSize as string) || ""}
          onChange={(e) =>
            e.target.value
              ? editor.chain().focus().setFontSize(e.target.value).run()
              : editor.chain().focus().unsetFontSize().run()
          }
          className={SELECT_CLS}
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
          className={SELECT_CLS}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <LinkClearGroup editor={editor} />
      </div>
    </div>
  );
}

const FULL_EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TextStyleKit,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];

// "inline" — heading/list/blockquote/code/rule nodes disabled so a paste of
// structured HTML can't smuggle them into a field that renders inside an
// <h2>. Paragraph + Text stay (the schema needs one block; stripped on
// save). No TextAlign.
const INLINE_EXTENSIONS = [
  StarterKit.configure({
    link: { openOnClick: false },
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
  }),
  TextStyleKit,
];

const FULL_CLASS =
  "min-h-24 w-full rounded-b-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_a]:underline";
const INLINE_CLASS =
  "w-full rounded-b-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent whitespace-nowrap overflow-x-auto [&_p]:m-0 [&_a]:underline";

export default function RichTextBlockEditor({
  blockId,
  value,
  onChange,
  label = "Text",
  mode = "full",
  colorPresets,
}: {
  blockId: string;
  value: string;
  onChange: (html: string) => void;
  label?: string;
  mode?: EditorMode;
  colorPresets?: { label: string; value: string }[];
}) {
  const syncedBlockId = useRef<string | null>(null);

  const editor = useEditor({
    // Next 16 / RSC — render on the client only to avoid a hydration mismatch.
    immediatelyRender: false,
    extensions: mode === "inline" ? INLINE_EXTENSIONS : FULL_EXTENSIONS,
    content: value || "",
    editorProps: {
      attributes: { class: mode === "inline" ? INLINE_CLASS : FULL_CLASS },
      ...(mode === "inline"
        ? {
            // Single-line: Enter never splits, pasted newlines collapse to
            // spaces so a multi-line paste lands as one line.
            handleKeyDown: (_view, event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                return true;
              }
              return false;
            },
            transformPastedText: (text: string) => text.replace(/\s*\n\s*/g, " "),
            transformPastedHTML: (html: string) => html.replace(/\s*\n\s*/g, " "),
          }
        : {}),
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(mode === "inline" ? stripOuterParagraph(html) : html);
    },
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
      {editor && <Toolbar editor={editor} mode={mode} colorPresets={colorPresets} />}
      <EditorContent editor={editor} />
    </div>
  );
}
