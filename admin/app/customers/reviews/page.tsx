"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listReviews, setReviewFeatured } from "@/lib/api";
import type { ReviewItem } from "@/lib/types";
import { consentLabel, disabledReason } from "@/lib/reviews";
import Card from "@/components/ui/Card";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import PageShell from "@/components/ui/PageShell";
import CustomersTabs from "@/components/CustomersTabs";

const PAGE_SIZE = 20;

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-xs text-text-faint">No rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-3.5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300 dark:text-zinc-600"}`} />
      ))}
    </span>
  );
}

// Survey feedback the shop has received, and which of it appears on the
// storefront's Testimonials section. Nothing is shown without the customer's
// own consent (ticked on the survey form) and the merchant's explicit switch.
export default function ReviewsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // UX redirect only; both endpoints are @Roles('admin') server-side.
  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  // Fetch in a promise callback (not a synchronous setState in the effect body);
  // `reloadKey` re-runs it after a toggle.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    listReviews({ page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (!live) return;
        setReviews(result.data);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load reviews");
      });
    return () => {
      live = false;
    };
  }, [page, reloadKey]);

  if (user && user.role !== "admin") return null;

  async function toggle(r: ReviewItem, featured: boolean) {
    setBusyId(r.id);
    try {
      await setReviewFeatured(r.id, featured);
      toast(featured ? "Review will show on your store" : "Review hidden from your store");
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update review", "error");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">
        Customers
      </h1>
      <CustomersTabs />

      <p className="text-xs text-text-faint mb-4">
        Feedback from your post-order survey. A review can be shown in your storefront&apos;s Testimonials section
        only when the customer ticked &ldquo;You may show my feedback on the store&apos;s website&rdquo; and left a
        comment. Customers see only their first name and last initial, never contact details.
      </p>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {reviews === null && !error ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : reviews !== null && reviews.length === 0 && !error ? (
        <EmptyState
          title="No survey responses yet"
          description="Turn on the customer survey in Store Configuration. Responses appear here after customers answer."
        />
      ) : (
        <ul className="space-y-3">
          {(reviews ?? []).map((r) => {
            const reason = disabledReason(r);
            return (
              <li key={r.id}>
                <Card className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Stars rating={r.rating} />
                        <span className="text-xs text-text-faint">
                          {new Date(r.respondedAt).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-text-faint">
                          {r.customerName} &middot; Order #{r.orderNumber}
                        </span>
                      </div>
                      {r.comment ? (
                        <p className="mt-2 text-sm text-text-primary dark:text-zinc-100 whitespace-pre-wrap break-words">
                          {r.comment}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-text-faint">No comment left.</p>
                      )}
                      <p className="mt-2 text-xs text-text-muted">{consentLabel(r.publishConsent)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <label className="flex flex-col items-end gap-1 text-xs font-medium text-text-muted">
                        Show on store
                        <Toggle
                          checked={r.featuredAt !== null}
                          disabled={busyId === r.id || (reason !== null && r.featuredAt === null)}
                          onChange={(v) => toggle(r, v)}
                        />
                      </label>
                    </div>
                  </div>
                  {reason && r.featuredAt === null && <p className="mt-2 text-xs text-text-faint">{reason}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {reviews !== null && reviews.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[13px] text-text-faint">
          <span>
            {(page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
