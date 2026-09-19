"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listNewsletterSubscribers } from "@/lib/api";
import type { NewsletterSubscriber } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import PageShell from "@/components/ui/PageShell";
import CustomersTabs from "@/components/CustomersTabs";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
// The list endpoint caps pageSize at 100, so a full export pages through.
const EXPORT_PAGE_SIZE = 100;

// The read side of the storefront newsletter widget, which until now wrote
// rows nobody could see. Read-only by design: the merchant never adds or
// edits a subscriber here (the only writer is the public widget), so there is
// no create button, no row click-through and no bulk action bar.
export default function NewsletterSubscribersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // UX redirect only; GET /newsletter-subscribers is independently
  // @Roles('admin', 'viewer')-gated server-side.
  useEffect(() => {
    if (!authLoading && user && user.role !== "admin" && user.role !== "viewer") router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const refresh = useCallback(async () => {
    try {
      const result = await listNewsletterSubscribers({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
      });
      setSubscribers(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load newsletter subscribers");
    }
  }, [page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (user && user.role !== "admin" && user.role !== "viewer") return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Exports every subscriber matching the current search, not just the page
  // on screen: a mailing list that exports 20 of 400 rows is worse than no
  // export at all. Pages through rather than raising the endpoint's cap, so
  // there is no size at which the file silently truncates.
  async function handleExport() {
    setExporting(true);
    try {
      const all: NewsletterSubscriber[] = [];
      for (let p = 1; ; p++) {
        const result = await listNewsletterSubscribers({
          page: p,
          pageSize: EXPORT_PAGE_SIZE,
          search: search || undefined,
        });
        all.push(...result.data);
        if (result.data.length < EXPORT_PAGE_SIZE || all.length >= result.total) break;
      }
      downloadCsv(
        `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Email", "Source", "Subscribed"],
        all.map((s) => [s.email, s.source, new Date(s.createdAt).toISOString()]),
      );
      toast(`Exported ${all.length} subscriber${all.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to export subscribers", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">
        Customers
      </h1>
      <CustomersTabs />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search email…"
            className="w-full h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-[13.5px] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleExport}
          loading={exporting}
          disabled={total === 0}
        >
          <Download className="size-3.5 inline -mt-0.5 mr-1" />
          Export CSV
        </Button>
      </div>

      <p className="text-xs text-text-faint mb-3">
        Everyone who submitted the newsletter form on your storefront. Collected automatically, nothing to
        set up.
      </p>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <Table>
        <THead>
          <tr>
            <TH>Email</TH>
            <TH>Source</TH>
            <TH>Subscribed</TH>
          </tr>
        </THead>
        <TBody>
          {subscribers === null ? (
            <tr>
              <td colSpan={3}>
                <TableSkeleton rows={8} cols={3} />
              </td>
            </tr>
          ) : subscribers.length === 0 && !error ? (
            <tr>
              <td colSpan={3}>
                <EmptyState
                  title={search ? "No matching subscribers" : "No subscribers yet"}
                  description={
                    search
                      ? "Try a different email."
                      : "Add a newsletter section to your storefront theme and signups will appear here."
                  }
                />
              </td>
            </tr>
          ) : (
            subscribers.map((s) => (
              <TR key={s.id}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">{s.email}</TD>
                <TD className="text-text-muted text-[13.5px]">{s.source}</TD>
                <TD className="text-xs text-text-faint">{new Date(s.createdAt).toLocaleDateString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {subscribers !== null && subscribers.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[13px] text-text-faint">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
