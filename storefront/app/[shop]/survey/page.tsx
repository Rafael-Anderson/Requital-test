"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { lookupSurvey, submitSurvey } from "@/lib/api";
import type { SurveyLookupResult } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import { AUTH_CARD_CLASS, AUTH_HEADING_CLASS, FIELD_CLASS, BUTTON_PRIMARY_CLASS } from "@/lib/form-styles";

function SurveyContent() {
  const { shop } = useShop();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [survey, setSurvey] = useState<SurveyLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function runLookup() {
    if (!token) {
      setError("This survey link is missing its token.");
      setLoading(false);
      return;
    }
    try {
      setSurvey(await lookupSurvey(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't find that survey");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitSurvey(token, { rating, comment: comment.trim() || undefined });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit your survey");
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyResponded = !!survey?.respondedAt;
  const displayRating = submitted ? rating : (survey?.rating ?? 0);

  return (
    <StorefrontPageShell variant="narrow">
      <div className={AUTH_CARD_CLASS}>
        <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>How was your order?</h1>

        {loading && <p className="text-sm text-zinc-500">Loading…</p>}

        {!loading && error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && survey && (alreadyResponded || submitted) && (
          <div>
            <p className="text-sm text-zinc-500 mb-3">
              Thanks for your feedback{shop?.name ? `. ${shop.name} appreciates it!` : "!"}
            </p>
            {displayRating > 0 && <p className="text-sm">Rating: {displayRating}/5</p>}
          </div>
        )}

        {!loading && survey && !alreadyResponded && !submitted && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-zinc-500 mb-2">
              We&apos;d love to know how your experience with {survey.shopName} went.
            </p>
            <div>
              <p className="text-sm font-medium mb-2">Rating</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={rating === n}
                    onClick={() => setRating(n)}
                    className={`size-10 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                      rating >= n ? "border-accent bg-accent/10 text-accent-text" : "border-stroke hover:border-black/30"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="survey-comment" className="text-sm font-medium block mb-1.5">
                Comment (optional)
              </label>
              <textarea
                id="survey-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className={FIELD_CLASS}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={submitting || rating < 1} className={BUTTON_PRIMARY_CLASS}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </form>
        )}
      </div>
    </StorefrontPageShell>
  );
}

export default function SurveyPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <SurveyContent />
    </Suspense>
  );
}
