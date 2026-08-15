"use client";

import Textarea from "@/components/ui/Textarea";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Mirrors backend theme-config.validation.ts's real limits (not just a UI
// placeholder — this CSS is genuinely injected into the live storefront on
// publish, see storefront/app/[shop]/ShopLayoutClient.tsx's CustomCss()).
// The actual reject-list enforcement happens server-side on save; this is
// just a live character counter and a soft heads-up, not a blocking check
// — a merchant typing "@import" mid-edit shouldn't get interrupted before
// they've finished. No "Learn more" link here: this app has no docs/help
// system to link out to, so one wasn't fabricated.
const MAX_CHARS = 1500;
const REJECTED_PATTERNS = [/<script/i, /@import/i, /@charset/i, /@namespace/i];

export default function CustomCssSettings({ editor }: { editor: ThemeEditorState }) {
  const css = editor.config!.globalSettings.customCss.css;
  const overLimit = css.length > MAX_CHARS;
  const hasRejectedPattern = REJECTED_PATTERNS.some((p) => p.test(css));

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Add CSS that applies across your whole storefront. Scoped automatically to your store&apos;s pages only.
      </p>
      <Textarea
        label="Custom CSS"
        rows={10}
        className="font-mono text-xs"
        value={css}
        onChange={(e) => editor.updateGlobalSettingsCategory("customCss", { css: e.target.value })}
      />
      <div className="flex items-center justify-between text-xs">
        <span className={overLimit ? "text-red-500" : "text-zinc-400"}>
          {css.length} / {MAX_CHARS} characters
        </span>
      </div>
      {(overLimit || hasRejectedPattern) && (
        <p className="text-xs text-red-500">
          {overLimit ? "Over the character limit. " : ""}
          {hasRejectedPattern ? "Contains disallowed CSS (e.g. @import/@charset/@namespace or <script>). " : ""}
          This will be rejected when you save.
        </p>
      )}
    </div>
  );
}
