"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { listFeaturedReviews } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import { resolveTextElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import type { FeaturedReview } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

function StarRating({ rating }: { rating: number }) {
  const filled = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <div className="mb-2 text-amber-500" aria-label={`${filled} out of 5 stars`}>
      {"★".repeat(filled)}
      <span className="text-zinc-300">{"★".repeat(5 - filled)}</span>
    </div>
  );
}

// Bounds mirror the backend's public query (limit 1..12) and the editor's 3-12.
const MAX_ITEMS_DEFAULT = 6;
export function resolveReviewQuery(settings: SectionSettings): { limit: number; minRating?: number } {
  const n = settings.maxItems;
  const limit = typeof n === "number" && Number.isFinite(n) ? Math.max(3, Math.min(12, Math.round(n))) : MAX_ITEMS_DEFAULT;
  const m = settings.minRating;
  const minRating = typeof m === "number" && m >= 1 && m <= 5 ? Math.round(m) : undefined;
  return { limit, minRating };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// Real reviews only. The content is whatever the merchant has approved in
// Admin > Reviews (customers who agreed to publish their feedback), fetched
// from the public API, so there is nothing to author here: any `testimonial`
// blocks a theme saved before this change are deliberately IGNORED, never
// rendered and never deleted. With no approved review the live storefront
// renders nothing at all (no heading, no "coming soon"); the theme editor's
// preview shows an explanatory card instead. Review text is rendered as a
// plain text node (React escapes it), never as HTML.
export default function TestimonialsSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { shopSlug, previewMode } = useShop();
  const [reviews, setReviews] = useState<FeaturedReview[] | null>(null);
  const { limit, minRating } = resolveReviewQuery(settings);

  useEffect(() => {
    let live = true;
    listFeaturedReviews(shopSlug, { limit, minRating })
      .then((r) => live && setReviews(Array.isArray(r) ? r : []))
      .catch(() => live && setReviews([]));
    return () => {
      live = false;
    };
  }, [shopSlug, limit, minRating]);

  const headingBlock = blocks.find((b) => b.type === "heading" && b.visible);
  const heading = typeof headingBlock?.settings.text === "string" ? headingBlock.settings.text : "";

  if (reviews === null) return null;

  if (reviews.length === 0) {
    if (!previewMode) return null;
    return (
      <div className="theme-gutter-x theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        <div className="border border-dashed border-stroke theme-round-md p-4 text-center text-sm text-zinc-500">
          <p className="font-medium">No approved reviews yet</p>
          <p className="mt-1">
            Customer reviews appear here once a customer agrees to publish their survey feedback and you switch on
            &ldquo;Show on store&rdquo; for it under Reviews. This section stays hidden on the live store until then.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-gutter-x theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {heading && headingBlock && (
        <h2
          className="text-xl font-semibold theme-heading-gap text-center"
          {...editableAttrs(previewMode, { id: headingBlock.id, sectionId, type: "heading", reorderable: true })}
          style={{ ...themeTextPresetStyle("h2"), ...resolveTextElementStyle(headingBlock.settings) }}
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(heading) }}
        />
      )}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r, i) => (
          <figure key={i} className="p-4 border border-stroke theme-round-md theme-stagger-child" style={{ "--i": i } as CSSProperties}>
            <StarRating rating={r.rating} />
            <blockquote
              className="text-sm leading-relaxed whitespace-pre-line before:content-['“'] after:content-['”']"
              style={themeTextPresetStyle("paragraph")}
            >
              {r.comment}
            </blockquote>
            <figcaption className="mt-3 text-xs opacity-70">
              <span className="font-medium">{r.name}</span>
              {formatDate(r.date) && <span> &middot; {formatDate(r.date)}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
