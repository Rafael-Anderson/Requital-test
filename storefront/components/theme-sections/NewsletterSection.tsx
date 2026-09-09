"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { subscribeNewsletter } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveButtonFillStyle,
  resolveButtonHoverClass,
  themeButtonBaseStyle,
  themeTextPresetStyle,
} from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Same shape as RichTextSection.tsx's own local copy — this section-level
// override was previously set by the admin panel's TypographyControls but
// never read anywhere on the storefront (a real dead control, found during
// the theme builder usability audit's dead-control sweep).
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

// Submits to POST /public/:shopSlug/newsletter-subscribe (backend
// newslettersubscriber table) — previously did nothing but preventDefault().
// heading/text/button copy come from this section's own blocks (see backend
// constants.ts's BLOCK_TYPES.newsletter), not flat section.settings fields.
export default function NewsletterSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { previewMode, shop, shopSlug, themeConfig } = useShop();
  const primaryButton = themeConfig?.globalSettings.buttons.primary;
  const buttonHover = resolveButtonHoverClass(primaryButton?.hoverEffect, primaryButton?.pressEffect);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // §8.7 item 5 — section.settings.successAnimation. Off/absent ⇒ the plain
  // instant text swap below, byte-identical to today.
  const successAnimation = settings.successAnimation === true;

  // §8.13.C item 7 — inputFields.focusAnimation. 'float-label' wraps the email
  // input in a CSS-only floating-label field; anything else (incl. absent) ⇒
  // today's bare placeholder input.
  const floatLabel = themeConfig?.globalSettings.inputFields?.focusAnimation === "float-label";

  const headingBlock = blocks.find((b) => b.type === "heading" && b.visible);
  const textBlock = blocks.find((b) => b.type === "text" && b.visible);
  const formBlock = blocks.find((b) => b.type === "email_form" && b.visible);
  const heading = typeof headingBlock?.settings.text === "string" ? headingBlock.settings.text : "";
  const subtext = typeof textBlock?.settings.text === "string" ? textBlock.settings.text : "";
  const buttonLabel =
    typeof formBlock?.settings.buttonLabel === "string" && formBlock.settings.buttonLabel ? formBlock.settings.buttonLabel : "Subscribe";

  if (!formBlock) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // The preview builder never actually submits a real email on the
    // merchant's behalf — same "selection, not the real action" rule
    // QuickAddButton follows for add-to-cart clicks inside the iframe.
    if (previewMode) return;
    setStatus("submitting");
    try {
      await subscribeNewsletter(shopSlug, email);
      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="px-4 sm:px-6 py-10 max-w-xl mx-auto text-center">
      {heading && headingBlock && (
        <h2
          {...editableAttrs(previewMode, { id: headingBlock.id, sectionId, type: "heading", reorderable: true })}
          className="text-xl font-semibold mb-2"
          style={{ ...themeTextPresetStyle("h2"), ...typographyStyle(settings.typography), ...resolveTextElementStyle(headingBlock.settings) }}
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(heading) }}
        />
      )}
      {subtext && textBlock && (
        <div
          {...editableAttrs(previewMode, { id: textBlock.id, sectionId, type: "subtext", reorderable: true })}
          className="text-sm opacity-70 mb-5 [&_p]:m-0"
          style={{ ...themeTextPresetStyle("paragraph"), ...typographyStyle(settings.typography), ...resolveTextElementStyle(textBlock.settings) }}
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(subtext) }}
        />
      )}
      {status === "success" ? (
        successAnimation ? (
          <div className="theme-newsletter-success flex items-center justify-center gap-2 text-sm font-medium">
            <Check className="size-5 text-accent" aria-hidden="true" />
            Thanks for subscribing!
          </div>
        ) : (
          <p className="text-sm font-medium">Thanks for subscribing!</p>
        )
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          {floatLabel ? (
            <label className="theme-float-label flex-1 text-left">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=" "
                className="w-full h-10 px-3 text-sm border border-stroke bg-transparent"
                style={{ borderRadius: "var(--theme-radius, 8px)" }}
              />
              <span>Email address</span>
            </label>
          ) : (
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 h-10 px-3 text-sm border border-stroke bg-transparent"
              style={{ borderRadius: "var(--theme-radius, 8px)" }}
            />
          )}
          <button
            type="submit"
            disabled={status === "submitting"}
            {...editableAttrs(previewMode, { id: formBlock.id, sectionId, type: "cta_button", reorderable: true })}
            className={`h-10 px-5 text-sm font-medium text-accent-foreground bg-accent disabled:opacity-60 ${buttonHover.className}`}
            style={{ ...themeButtonBaseStyle(), ...resolveButtonFillStyle(shop?.buttonFill), ...resolveButtonElementStyle(formBlock.settings) }}
          >
            {status === "submitting" ? "Submitting…" : buttonLabel}
            {buttonHover.showIcon && status !== "submitting" && (
              <ArrowRight className="theme-btn-icon inline-block ml-1.5 size-4 align-[-3px]" aria-hidden="true" />
            )}
          </button>
        </form>
      )}
      {status === "error" && <p className="mt-2 text-xs text-red-600">{errorMessage}</p>}
    </div>
  );
}
