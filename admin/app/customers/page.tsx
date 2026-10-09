"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useShopMode } from "@/lib/useShopMode";
import { listCustomers, listCustomerTags, type ListCustomersParams,
  downloadExport,
} from "@/lib/api";
import type { CustomerListItem, CustomerTagWithCount } from "@/lib/types";
import { useRowSelection } from "@/lib/useRowSelection";
import { downloadCsv } from "@/lib/csv";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import Select from "@/components/ui/Select";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import BulkActionBar from "@/components/ui/BulkActionBar";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import PageShell from "@/components/ui/PageShell";
import CustomersTabs from "@/components/CustomersTabs";
import { formatMoney } from "@/lib/money";
import { useShopCurrency } from "@/lib/useShopCurrency";
import { TagChip } from "@/components/customers/CustomerTagsCard";
import CustomerTagBulkControls from "@/components/customers/CustomerTagBulkControls";
import ManageTagsModal from "@/components/customers/ManageTagsModal";

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
  const currency = useShopCurrency();
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
  const [tags, setTags] = useState<CustomerTagWithCount[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [managingTags, setManagingTags] = useState(false);
  const [tagsTick, setTagsTick] = useState(0);
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
  }, [search, sortBy, sortDir, tagFilter]);

  // The shop's tag list feeds the filter and the bulk controls. Its own request:
  // if it fails the list still loads, just without the tag filter.
  useEffect(() => {
    if (user?.role !== "admin") return;
    let live = true;
    listCustomerTags()
      .then((d) => live && setTags(d))
      .catch(() => live && setTags([]));
    return () => {
      live = false;
    };
  }, [user, tagsTick]);

  const refresh = useCallback(async () => {
    try {
      const result = await listCustomers({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        sortBy,
        sortDir,
        tagId: tagFilter ? Number(tagFilter) : undefined,
      });
      setCustomers(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers");
    }
  }, [page, search, sortBy, sortDir, tagFilter]);

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
  // Two distinct actions, deliberately kept separate. "Export CSV" in the bulk
  // bar exports exactly the rows the merchant ticked, which only ever exist in
  // the browser. "Export all" (ANL-11) streams every customer from the server -
  // the thing that was genuinely impossible before, since a selection can only
  // contain rows the current page had already loaded. The active search is
  // passed through so the file matches what is on screen.
  async function handleExportAll() {
    try {
      await downloadExport("customers", { search: search || undefined });
      toast("Export started");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to export customers", "error");
    }
  }

  function handleBulkExport() {
    const rows = (customers ?? []).filter((c) => selection.selected.has(c.id));
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Phone", "Orders", "Lifetime Value", "Last Order"],
      rows.map((c) => [c.name, c.phone, c.orderCount, c.lifetimeValue.toFixed(2), c.lastOrderDate ?? ""]),
    );
    toast(`Exported ${rows.length} customer${rows.length === 1 ? "" : "s"}`);
  }

  // Stand-in for the rows when there are none to show (also keeps a failed
  // first load from sitting on the skeleton forever).
  const placeholder =
    customers === null && error ? (
      <LoadFailed what="customers" onRetry={refresh} />
    ) : customers !== null && customers.length === 0 && !error ? (
      <EmptyState
        title={search ? "No matching customers" : "No customers yet"}
        description={
          search ? "Try a different name or phone number." : "Customers appear here automatically once an order is placed."
        }
      />
    ) : null;

  return (
    <PageShell>
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">Customers</h1>
      <CustomersTabs />
      <div className="flex items-center justify-end mb-6 flex-wrap gap-2">
        {tags.length > 0 && (
          <div className="w-full sm:w-48">
            <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.customerCount})
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button size="sm" variant="secondary" onClick={() => setManagingTags(true)}>
          Manage tags
        </Button>
        <div className="relative w-full sm:w-64">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 ps-8 pe-3 text-[13.5px] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <div className="flex justify-end mb-3">
        <Button size="sm" variant="secondary" onClick={handleExportAll}>
          Export all
        </Button>
      </div>

      {!isSimple && (
        <BulkActionBar count={selection.selectedIds.length} onClear={selection.clear}>
          <Button size="sm" variant="secondary" onClick={handleBulkExport}>
            Export CSV
          </Button>
          <CustomerTagBulkControls
            customerIds={selection.selectedIds}
            tags={tags}
            onDone={() => {
              setTagsTick((t) => t + 1);
              void refresh();
            }}
          />
        </BulkActionBar>
      )}

      {/* Below md: a tappable card per customer, with a sort control standing in
          for the table's sortable headers; md and up: the table. */}
      <div className="mb-3 flex items-center gap-2 md:hidden">
        <div className="min-w-0 flex-1">
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            aria-label="Sort customers by"
          >
            {COLUMNS.map(({ field, label }) => (
              <option key={field} value={field}>
                Sort: {label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          aria-label={sortDir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
        >
          {sortDir === "asc" ? "▲" : "▼"}
        </Button>
      </div>
      {customers === null && !error ? (
        <CardListSkeleton rows={6} selectable={!isSimple} />
      ) : placeholder ? (
        <div className="rounded-2xl border border-border bg-surface md:hidden dark:border-white/10 dark:bg-zinc-900">
          {placeholder}
        </div>
      ) : (
        <CardList
          selectAll={
            isSimple
              ? undefined
              : { checked: selection.allSelected, onChange: selection.toggleAll, label: "Select all customers" }
          }
        >
          {(customers ?? []).map((c) => (
            <CardListItem
              key={c.id}
              href={`/customers/${c.id}`}
              openLabel={`Open ${c.name}`}
              select={
                isSimple
                  ? undefined
                  : {
                      checked: selection.selected.has(c.id),
                      onChange: () => selection.toggle(c.id),
                      label: `Select ${c.name}`,
                    }
              }
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{c.name}</div>
              <div className="truncate text-[13.5px] text-text-muted">{isSimple && c.email ? c.email : c.phone}</div>
              {c.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <TagChip key={t.id} tag={t} />
                  ))}
                </div>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                <span className="font-bold text-text-primary dark:text-zinc-100">{formatMoney(c.lifetimeValue, currency)}</span>
                <span className="text-text-muted">
                  {c.orderCount} order{c.orderCount === 1 ? "" : "s"}
                </span>
                <span className="text-xs text-text-faint">
                  {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : "No orders yet"}
                </span>
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table className="hidden md:block">
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
                  className="flex items-center gap-1 cursor-pointer uppercase tracking-wide hover:text-text-secondary dark:hover:text-zinc-200"
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
          {customers === null && !error ? (
            <tr>
              <td colSpan={colCount}>
                <TableSkeleton rows={8} cols={colCount} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={colCount}>{placeholder}</td>
            </tr>
          ) : (
            (customers ?? []).map((c) => (
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
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">
                  {c.name}
                  {c.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 font-normal">
                      {c.tags.map((t) => (
                        <TagChip key={t.id} tag={t} />
                      ))}
                    </div>
                  )}
                </TD>
                <TD className="text-text-muted text-[13.5px]">{c.phone}</TD>
                <TD className="text-[13.5px]">{c.orderCount}</TD>
                <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">{formatMoney(c.lifetimeValue, currency)}</TD>
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-text-faint">
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
      {managingTags && (
        <ManageTagsModal
          onClose={() => {
            setManagingTags(false);
            setTagsTick((t) => t + 1);
            void refresh();
          }}
        />
      )}
    </PageShell>
  );
}
