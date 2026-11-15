"use client";

import Button from "./Button";
import Select from "./Select";

// The ONE pagination footer for an admin list. It is presentational: the page owns
// page, pageSize and total (and where they live, e.g. the URL via
// lib/useUrlPagination.ts), this renders "1-20 of N", Previous/Next, page numbers
// and the per-page selector, and optionally a SEPARATE "Show all" button.
//
// Logical properties only; the number strip wraps below sm so nothing is wider
// than the phone it is on.

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

// The page numbers to show: always the first and last, the current page and its
// neighbours, with a gap marker ("...") where pages are skipped.
export function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  const wanted = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) out.push("gap");
    out.push(pages[i]);
  }
  return out;
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = "items",
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  onShowAll,
  showingAll = false,
  loadingAll = false,
  disabled = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  noun?: string;
  pageSizeOptions?: readonly number[];
  // A separate button that loads everything on one long page. Omit it for a list
  // where that makes no sense.
  onShowAll?: () => void;
  showingAll?: boolean;
  loadingAll?: boolean;
  disabled?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <p className="text-text-muted dark:text-zinc-400" aria-live="polite">
        {showingAll ? `Showing all ${total} ${noun}` : total === 0 ? `0 ${noun}` : `${from}-${to} of ${total}`}
      </p>

      {!showingAll && totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          {pageWindow(page, totalPages).map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-text-faint">
                ...
              </span>
            ) : (
              <Button
                key={n}
                size="sm"
                variant={n === page ? "primary" : "secondary"}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
                disabled={disabled}
                onClick={() => onPageChange(n)}
              >
                {n}
              </Button>
            ),
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {!showingAll && (
          <div className="flex items-center gap-2">
            <label htmlFor="pagination-page-size" className="text-text-muted dark:text-zinc-400">
              Per page
            </label>
            <div className="w-20">
              <Select
                id="pagination-page-size"
                value={String(pageSize)}
                disabled={disabled}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
        {onShowAll && (
          <Button size="sm" variant="secondary" loading={loadingAll} disabled={disabled} onClick={onShowAll}>
            {showingAll ? "Back to pages" : "Show all"}
          </Button>
        )}
      </div>
    </nav>
  );
}
