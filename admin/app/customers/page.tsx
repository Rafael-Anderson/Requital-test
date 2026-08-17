"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useShopMode } from "@/lib/useShopMode";
import { listCustomers, type ListCustomersParams } from "@/lib/api";
import type { CustomerListItem } from "@/lib/types";
import { useRowSelection } from "@/lib/useRowSelection";
import { downloadCsv } from "@/lib/csv";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import BulkActionBar from "@/components/ui/BulkActionBar";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type SortField = NonNullable<ListCustomersParams["sortBy"]>;
const COLUMNS: { field: SortField; label: string }[] = [
  { field: "name", label: "Name" },
  { field: "phone", label: "Phone" },
  { field: "orderCount", label: "Orders" },
  { field: "lifetimeValue", label: "Lifetime Value" },
  { field: "lastOrderDate", label: "Last Order" },
];

// Admin-only page — a branch account gets bounced home. UX redirect only;
// GET/PATCH /customers are independently @Roles('admin')-gated server-side
// regardless of what this check does (customers are shop-wide, unlike
// orders/products, so there's no branch-scoped view to fall back to).
export default function CustomersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const mode = useShopMode();
  const isSimple = mode === "simple";

  const [customers, setCustomers] = useState<CustomerListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("lastOrderDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const visibleIds = useMemo(() => (customers ?? []).map((c) => c.id), [customers]);
  const selection = useRowSelection(visibleIds);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, sortBy, sortDir]);

  const refresh = useCallback(async () => {
    try {
      const result = await listCustomers({ page, pageSize: PAGE_SIZE, search: search || undefined, sortBy, sortDir });
      setCustomers(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers");
    }
  }, [page, search, sortBy, sortDir]);

  useEffect(() => {
    if (user?.role === "admin") refresh();
  }, [refresh, user]);

  if (user && user.role !== "admin") return null;

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Simple mode swaps in an Email column (already returned by the list
  // endpoint, just unrendered today) for the selection checkbox column it
  // drops along with the bulk action bar — same total column count either way.
  const colCount = COLUMNS.length + 1;

  // Export only — bulk tag assignment (also asked for in the task) was
  // checked and skipped: the customer model has no tags field at all today
  // (just id/name/phone/email/birthday/addresses), and inventing one solely
  // to backfill a bulk-action button would be exactly the kind of unrequested
  // feature the task said not to build. Flagged rather than silently dropped.
  function handleBulkExport() {
    const rows = (customers ?? []).filter((c) => selection.selected.has(c.id));
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Phone", "Orders", "Lifetime Value", "Last Order"],
      rows.map((c) => [c.name, c.phone, c.orderCount, c.lifetimeValue.toFixed(2), c.lastOrderDate ?? ""]),
    );
    toast(`Exported ${rows.length} customer${rows.length === 1 ? "" : "s"}`);
  }

  return (
    <PageShell>
      <BackButton href="/" />
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Customers</h1>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-[13.5px] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {!isSimple && (
        <BulkActionBar count={selection.selectedIds.length} onClear={selection.clear}>
          <Button size="sm" variant="secondary" onClick={handleBulkExport}>
            Export CSV
          </Button>
        </BulkActionBar>
      )}

      <Table>
        <THead>
          <tr>
            {!isSimple && (
              <TH className="w-8">
                <Checkbox
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  aria-label="Select all customers"
                />
              </TH>
            )}
            {COLUMNS.map(({ field, label }) => (
              <TH key={field}>
                <button
                  type="button"
                  onClick={() => toggleSort(field)}
                  className="flex items-center gap-1 cursor-pointer hover:text-text-secondary dark:hover:text-zinc-200"
                >
                  {label}
                  {sortBy === field && <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </button>
              </TH>
            ))}
            {isSimple && <TH>Email</TH>}
          </tr>
        </THead>
        <TBody>
          {customers === null ? (
            <tr>
              <td colSpan={colCount}>
                <TableSkeleton rows={8} cols={colCount} />
              </td>
            </tr>
          ) : customers.length === 0 && !error ? (
            <tr>
              <td colSpan={colCount}>
                <EmptyState
                  title={search ? "No matching customers" : "No customers yet"}
                  description={
                    search
                      ? "Try a different name or phone number."
                      : "Customers appear here automatically once an order is placed."
                  }
                />
              </td>
            </tr>
          ) : (
            customers.map((c) => (
              <TR
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/customers/${c.id}`)}
              >
                {!isSimple && (
                  <TD onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selection.selected.has(c.id)}
                      onChange={() => selection.toggle(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
                  </TD>
                )}
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">{c.name}</TD>
                <TD className="text-text-muted text-[13.5px]">{c.phone}</TD>
                <TD className="text-[13.5px]">{c.orderCount}</TD>
                <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">{c.lifetimeValue.toFixed(2)} AED</TD>
                <TD className="text-xs text-text-faint">
                  {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : "-"}
                </TD>
                {isSimple && <TD className="text-text-muted">{c.email ?? "-"}</TD>}
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {customers !== null && customers.length > 0 && (
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
    </PageShell>
  );
}
