"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Tag, Users, UserCheck, Clock, Wallet } from "lucide-react";
import { getAffiliateSummary, listAffiliates } from "@/lib/api";
import type { AffiliateListItem, AffiliateSummary } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem } from "@/components/ui/CardList";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import StatCard from "@/components/ui/StatCard";
import AffiliateFormModal from "@/components/AffiliateFormModal";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_CLASS: Record<string, string> = {
  active: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  inactive: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
  blocked: "bg-danger-bg text-danger-text dark:bg-red-900 dark:text-red-200",
};

export default function AffiliatePage() {
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AffiliateListItem | null | "new">(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  // The summary cards and the list load on independent chains: neither waits
  // on, or is lost to, the other. Each ends in an error with Try again, and a
  // `latest` counter drops a response a newer refresh has superseded.
  const latestSummary = useRef(0);
  const refreshSummary = useCallback(() => {
    const mine = ++latestSummary.current;
    getAffiliateSummary()
      .then((res) => {
        if (mine !== latestSummary.current) return;
        setSummary(res);
        setSummaryError(null);
      })
      .catch((err) => {
        if (mine !== latestSummary.current) return;
        setSummaryError(err instanceof Error ? err.message : "Failed to load the summary");
      });
  }, []);

  const latestList = useRef(0);
  const refreshList = useCallback(() => {
    const mine = ++latestList.current;
    listAffiliates({ page, pageSize: PAGE_SIZE, search: search || undefined })
      .then((res) => {
        if (mine !== latestList.current) return;
        setAffiliates(res.data);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latestList.current) return;
        setError(err instanceof Error ? err.message : "Failed to load affiliates");
      });
  }, [page, search]);

  const refresh = useCallback(() => {
    refreshSummary();
    refreshList();
  }, [refreshSummary, refreshList]);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <div className="flex items-center justify-end mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-faint" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or mobile…"
              className="w-full h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 ps-8 pe-3 text-[13.5px] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            />
          </div>
          <Button variant="primary" onClick={() => setEditing("new")}>
            Add User
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {!summary && summaryError ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <LoadFailed what="the summary" onRetry={refreshSummary} />
          </div>
        ) : !summary ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Total Code" value={String(summary.totalCode)} icon={<Tag className="size-4" />} />
            <StatCard label="Total Affiliate" value={String(summary.totalAffiliate)} icon={<Users className="size-4" />} />
            <StatCard
              label="Active Affiliate"
              value={String(summary.activeAffiliate)}
              icon={<UserCheck className="size-4" />}
            />
            <StatCard label="Pending Orders" value={String(summary.pendingOrders)} icon={<Clock className="size-4" />} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-start">
        {!summary ? (
          summaryError ? null : <CardSkeleton />
        ) : (
          <StatCard
            label="Approved Order Revenue"
            value={summary.approvedOrderRevenue.toFixed(2)}
            icon={<Wallet className="size-4" />}
          />
        )}
        {!summary ? (
          summaryError ? null : <CardSkeleton />
        ) : (
          <Card>
            <p className="text-[13.5px] text-text-muted mb-4">Affiliate Code Status ({summary.codeStatus.approved + summary.codeStatus.pending + summary.codeStatus.blocked})</p>
            <div className="grid grid-cols-3 text-center">
              <div>
                <div className="text-[22px] font-extrabold text-success dark:text-green-400">{summary.codeStatus.approved}</div>
                <div className="text-xs text-text-faint mt-1">Approved</div>
              </div>
              <div>
                <div className="text-[22px] font-extrabold text-warning-text dark:text-amber-400">{summary.codeStatus.pending}</div>
                <div className="text-xs text-text-faint mt-1">Pending</div>
              </div>
              <div>
                <div className="text-[22px] font-extrabold text-danger-text dark:text-red-400">{summary.codeStatus.blocked}</div>
                <div className="text-xs text-text-faint mt-1">Blocked</div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {affiliates !== null && affiliates.length > 0 && (
        <CardList>
          {affiliates.map((a) => (
            <CardListItem
              key={a.id}
              onOpen={() => setEditing(a)}
              openLabel={`Edit ${a.name}`}
              actions={
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${STATUS_CLASS[a.status] ?? "bg-neutral-chip-bg text-neutral-chip-text"}`}
                >
                  {a.status}
                </span>
              }
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{a.name}</div>
              <div className="truncate text-xs text-text-muted">{a.mobile}</div>
              <div className="mt-0.5 text-xs text-text-muted">
                {a.codesCount} code{a.codesCount === 1 ? "" : "s"} · {a.ordersCount} order{a.ordersCount === 1 ? "" : "s"} ·{" "}
                {new Date(a.createdAt).toLocaleDateString()}
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table stickyFirst className={affiliates !== null && affiliates.length > 0 ? "hidden md:block" : ""}>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Mobile</TH>
            <TH>Status</TH>
            <TH>Codes</TH>
            <TH>Orders</TH>
            <TH>Created</TH>
            <TH>Action</TH>
          </tr>
        </THead>
        <TBody>
          {affiliates === null ? (
            <tr>
              <td colSpan={7}>
                {error ? <LoadFailed what="affiliates" onRetry={refreshList} /> : <TableSkeleton rows={8} cols={7} />}
              </td>
            </tr>
          ) : affiliates.length === 0 && !error ? (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  title={search ? "No matching affiliates" : "No affiliates yet"}
                  description={search ? "Try a different name or mobile number." : "Add your first affiliate to get started."}
                />
              </td>
            </tr>
          ) : (
            affiliates.map((a) => (
              <TR key={a.id}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">{a.name}</TD>
                <TD className="text-text-muted text-[13.5px]">{a.mobile}</TD>
                <TD>
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${STATUS_CLASS[a.status] ?? "bg-neutral-chip-bg text-neutral-chip-text"}`}
                  >
                    {a.status}
                  </span>
                </TD>
                <TD className="text-[13.5px]">{a.codesCount}</TD>
                <TD className="text-[13.5px]">{a.ordersCount}</TD>
                <TD className="text-xs text-text-faint">{new Date(a.createdAt).toLocaleDateString()}</TD>
                <TD>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {affiliates !== null && affiliates.length > 0 && (
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
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <AffiliateFormModal
          affiliate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
