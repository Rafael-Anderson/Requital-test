"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Tag, Users, UserCheck, Clock, Wallet } from "lucide-react";
import { getAffiliateSummary, listAffiliates } from "@/lib/api";
import type { AffiliateListItem, AffiliateSummary } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import AffiliateFormModal from "@/components/AffiliateFormModal";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_CLASS: Record<string, string> = {
  active: "text-green-600 dark:text-green-400",
  inactive: "text-zinc-400",
  blocked: "text-red-600 dark:text-red-400",
};

export default function AffiliatePage() {
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AffiliateListItem | null | "new">(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const refresh = useCallback(async () => {
    try {
      const [summaryRes, listRes] = await Promise.all([
        getAffiliateSummary(),
        listAffiliates({ page, pageSize: PAGE_SIZE, search: search || undefined }),
      ]);
      setSummary(summaryRes);
      setAffiliates(listRes.data);
      setTotal(listRes.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load affiliates");
    }
  }, [page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or mobile…"
            className="w-full h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add User
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {!summary ? (
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
          <CardSkeleton />
        ) : (
          <StatCard
            label="Approved Order Revenue"
            value={summary.approvedOrderRevenue.toFixed(2)}
            icon={<Wallet className="size-4" />}
          />
        )}
        {!summary ? (
          <CardSkeleton />
        ) : (
          <Card>
            <p className="text-sm text-zinc-500 mb-3">Affiliate Code Status ({summary.codeStatus.approved + summary.codeStatus.pending + summary.codeStatus.blocked})</p>
            <div className="grid grid-cols-3 text-center">
              <div>
                <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{summary.codeStatus.approved}</div>
                <div className="text-xs text-zinc-500 mt-1">Approved</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400">{summary.codeStatus.pending}</div>
                <div className="text-xs text-zinc-500 mt-1">Pending</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-red-600 dark:text-red-400">{summary.codeStatus.blocked}</div>
                <div className="text-xs text-zinc-500 mt-1">Blocked</div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
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
                <TableSkeleton rows={8} cols={7} />
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
                <TD className="font-medium">{a.name}</TD>
                <TD className="text-zinc-500">{a.mobile}</TD>
                <TD className={`capitalize font-medium ${STATUS_CLASS[a.status] ?? ""}`}>{a.status}</TD>
                <TD>{a.codesCount}</TD>
                <TD>{a.ordersCount}</TD>
                <TD className="text-xs text-zinc-500">{new Date(a.createdAt).toLocaleDateString()}</TD>
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
        <div className="flex items-center justify-between mt-3 text-sm text-zinc-500">
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
