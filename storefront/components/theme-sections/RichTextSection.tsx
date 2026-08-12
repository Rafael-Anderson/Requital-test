import type { CSSProperties } from "react";
import type { SectionSettings } from "@/lib/theme-config-types";

function typographyStyle(typography: SectionSettings["typography"]): CSSProperties {
  if (!typography) return {};
  return {
    fontFamily: typeof typography.fontFamily === "string" ? typography.fontFamily : undefined,
    fontSize: typeof typography.fontSize === "number" ? `${typography.fontSize}px` : undefined,
    fontWeight: typeof typography.fontWeight === "string" ? typography.fontWeight : undefined,
    color: typeof typography.color === "string" ? typography.color : undefined,
    letterSpacing: typeof typography.letterSpacing === "number" ? `${typography.letterSpacing}px` : undefined,
  };
}

// Plain text, not HTML — the admin RichTextSettings editor is a plain
// <Textarea>, not RichTextEditor.tsx, so there's no markup to sanitize/
// render here (see that file's own comment on the choice).
export default function RichTextSection({ settings }: { settings: SectionSettings }) {
  const text = typeof settings.text === "string" ? settings.text : "";
  if (!text) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      <p className="whitespace-pre-line leading-relaxed" style={typographyStyle(settings.typography)}>
        {text}
      </p>
    </div>
  );
}
