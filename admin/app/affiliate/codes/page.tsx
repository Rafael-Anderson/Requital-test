"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Copy } from "lucide-react";
import { listAffiliateCodes } from "@/lib/api";
import type { AffiliateCodeListItem } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import AffiliateCodeFormModal from "@/components/AffiliateCodeFormModal";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_CLASS: Record<string, string> = {
  approved: "text-green-600 dark:text-green-400",
  pending: "text-amber-600 dark:text-amber-400",
  blocked: "text-red-600 dark:text-red-400",
};

function formatValidity(from: string | null, until: string | null) {
  if (!from && !until) return "Always";
  const f = from ? new Date(from).toLocaleDateString() : "…";
  const u = until ? new Date(until).toLocaleDateString() : "…";
  return `${f} – ${u}`;
}

export default function AffiliateCodesPage() {
  const toast = useToast();
  const [codes, setCodes] = useState<AffiliateCodeListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AffiliateCodeListItem | null | "new">(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const refresh = useCallback(async () => {
    try {
      const res = await listAffiliateCodes({ page, pageSize: PAGE_SIZE, search: search || undefined });
      setCodes(res.data);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load affiliate codes");
    }
  }, [page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Could not copy link", "error");
    }
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code or promotion…"
            className="w-full h-9 rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          + Add Referral
        </Button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Code</TH>
            <TH>Orders</TH>
            <TH>Promotion For</TH>
            <TH>URL</TH>
            <TH>Code Status</TH>
            <TH>Commission Type</TH>
            <TH>Commission Value</TH>
            <TH>Validity</TH>
            <TH>Action</TH>
          </tr>
        </THead>
        <TBody>
          {codes === null ? (
            <tr>
              <td colSpan={9}>
                <TableSkeleton rows={8} cols={9} />
              </td>
            </tr>
          ) : codes.length === 0 && !error ? (
            <tr>
              <td colSpan={9}>
                <EmptyState
                  title={search ? "No matching codes" : "No referral codes yet"}
                  description={search ? "Try a different code or promotion." : "Add a referral code to get started."}
                />
              </td>
            </tr>
          ) : (
            codes.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.code}</TD>
                <TD>{c.ordersCount}</TD>
                <TD className="text-text-muted">{c.promotionFor}</TD>
                <TD>
                  <button
                    type="button"
                    onClick={() => copyUrl(c.url)}
                    className="flex items-center gap-1 text-xs text-accent-text dark:text-accent hover:underline cursor-pointer"
                  >
                    <Copy className="size-3" />
                    Copy link
                  </button>
                </TD>
                <TD className={`capitalize font-medium ${STATUS_CLASS[c.status] ?? ""}`}>{c.status}</TD>
                <TD className="capitalize">{c.commissionType}</TD>
                <TD>{c.commissionType === "percentage" ? `${c.commissionValue}%` : c.commissionValue.toFixed(2)}</TD>
                <TD className="text-xs text-text-muted">{formatValidity(c.validFrom, c.validUntil)}</TD>
                <TD>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {codes !== null && codes.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
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
        <AffiliateCodeFormModal
          affiliateCode={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
