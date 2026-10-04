"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Pencil, Plus, Trash2, Upload } from "lucide-react";
import {
  clearNotFoundLog,
  deleteUrlRedirect,
  dismissNotFoundEntry,
  listNotFoundLog,
  listUrlRedirects,
  updateUrlRedirect,
} from "@/lib/api";
import type { NotFoundLogList, UrlRedirect, UrlRedirectList } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import PageShell from "@/components/ui/PageShell";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Select from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardRowMenu } from "@/components/ui/CardList";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Toggle from "@/components/ui/Toggle";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import UrlRedirectFormModal from "@/components/UrlRedirectFormModal";
import UrlRedirectImportModal from "@/components/UrlRedirectImportModal";

type Tab = "redirects" | "404";

const iconButton =
  "p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default function RedirectsPage() {
  const [tab, setTab] = useState<Tab>("redirects");
  const [redirects, setRedirects] = useState<UrlRedirectList | null>(null);
  const [log, setLog] = useState<NotFoundLogList | null>(null);
  const [redirectsError, setRedirectsError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [redirectSearch, setRedirectSearch] = useState("");
  const [redirectPage, setRedirectPage] = useState(1);
  const [logSearch, setLogSearch] = useState("");
  const [logSort, setLogSort] = useState<"hits" | "recent">("hits");
  const [logPage, setLogPage] = useState(1);
  const [form, setForm] = useState<{ redirect: UrlRedirect | null; initialFrom?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UrlRedirect | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // The two lists load on independent chains (neither waits on the other), each
  // with a stale-response guard and its own error with Try again.
  const latestRedirects = useRef(0);
  const refreshRedirects = useCallback(() => {
    const mine = ++latestRedirects.current;
    listUrlRedirects({ search: redirectSearch || undefined, sort: "recent", page: redirectPage })
      .then((list) => {
        if (mine !== latestRedirects.current) return;
        setRedirects(list);
        setRedirectsError(null);
      })
      .catch((err) => {
        if (mine !== latestRedirects.current) return;
        setRedirectsError(err instanceof Error ? err.message : "Failed to load redirects");
      });
  }, [redirectSearch, redirectPage]);

  const latestLog = useRef(0);
  const refreshLog = useCallback(() => {
    const mine = ++latestLog.current;
    listNotFoundLog({ search: logSearch || undefined, sort: logSort, page: logPage })
      .then((list) => {
        if (mine !== latestLog.current) return;
        setLog(list);
        setLogError(null);
      })
      .catch((err) => {
        if (mine !== latestLog.current) return;
        setLogError(err instanceof Error ? err.message : "Failed to load the 404 report");
      });
  }, [logSearch, logSort, logPage]);

  useEffect(() => {
    refreshRedirects();
  }, [refreshRedirects]);

  useEffect(() => {
    refreshLog();
  }, [refreshLog]);

  async function toggleActive(row: UrlRedirect, active: boolean) {
    try {
      await updateUrlRedirect(row.id, { active });
      refreshRedirects();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update redirect", "error");
    }
  }

  async function handleDelete(row: UrlRedirect) {
    setBusy(true);
    try {
      await deleteUrlRedirect(row.id);
      toast("Redirect deleted");
      setConfirmDelete(null);
      refreshRedirects();
      refreshLog();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete redirect", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss(id: number) {
    try {
      await dismissNotFoundEntry(id);
      refreshLog();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to dismiss", "error");
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await clearNotFoundLog();
      toast("404 report cleared");
      setConfirmClear(false);
      refreshLog();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear the report", "error");
    } finally {
      setBusy(false);
    }
  }

  const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

  return (
    <PageShell variant="wide">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold">Redirects</h1>
        {tab === "redirects" && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="size-4 inline -mt-0.5 me-1" />
              Import CSV
            </Button>
            <Button variant="primary" onClick={() => setForm({ redirect: null })}>
              <Plus className="size-4 inline -mt-0.5 me-1" />
              Add redirect
            </Button>
          </div>
        )}
      </div>

      <p className="text-sm text-text-muted mb-4">
        Send visitors from an old address to the right page, so links and search rankings survive a move. The 404
        report lists addresses visitors asked for that do not exist, so you can redirect the ones that matter.
      </p>

      <div className="mb-4">
        <SegmentedToggle
          value={tab}
          onChange={setTab}
          options={[
            { value: "redirects", label: "Redirects" },
            { value: "404", label: "404 report" },
          ]}
        />
      </div>

      {(tab === "redirects" ? redirectsError : logError) && (
        <InlineErrorMessage className="mb-3">{tab === "redirects" ? redirectsError : logError}</InlineErrorMessage>
      )}

      {tab === "redirects" && (
        <Card>
          <div className="mb-3 max-w-sm">
            <Input
              label="Search"
              value={redirectSearch}
              onChange={(e) => {
                setRedirectSearch(e.target.value);
                setRedirectPage(1);
              }}
              placeholder="Search by address"
            />
          </div>
          {redirects === null ? (
            redirectsError ? <LoadFailed what="redirects" onRetry={refreshRedirects} /> : <TableSkeleton rows={4} cols={5} />
          ) : redirects.data.length === 0 ? (
            <EmptyState
              title="No redirects yet"
              description="Add a redirect, or import a CSV of old addresses and where they should go."
            />
          ) : (
            <>
              <CardList>
                {redirects.data.map((r) => (
                  <CardListItem
                    key={r.id}
                    onOpen={() => setForm({ redirect: r })}
                    openLabel={`Edit redirect from ${r.fromPath}`}
                    actions={
                      <div className="flex flex-col items-end gap-1">
                        <Toggle checked={r.active} onChange={(v) => toggleActive(r, v)} />
                        <CardRowMenu
                          label={`More actions for the redirect from ${r.fromPath}`}
                          items={[
                            { label: "Edit", icon: <Pencil className="size-3.5" />, onClick: () => setForm({ redirect: r }) },
                            { label: "Delete", icon: <Trash2 className="size-3.5" />, onClick: () => setConfirmDelete(r), danger: true },
                          ]}
                        />
                      </div>
                    }
                  >
                    <div className="break-all font-mono text-[13px] text-text-primary dark:text-zinc-100">{r.fromPath}</div>
                    <div className="break-all font-mono text-xs text-text-muted">to {r.toTarget}</div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {r.statusCode === 301 ? "Permanent" : "Temporary"} · {r.hitCount} visit{r.hitCount === 1 ? "" : "s"}
                    </div>
                  </CardListItem>
                ))}
              </CardList>
              <Table className="hidden md:block">
                <THead>
                  <TR>
                    <TH>Old address</TH>
                    <TH>Sends to</TH>
                    <TH className="w-24">Type</TH>
                    <TH className="w-20">Visits</TH>
                    <TH className="w-20">Active</TH>
                    <TH className="w-24 text-end">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {redirects.data.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-mono text-[13px] break-all">{r.fromPath}</TD>
                      <TD className="font-mono text-[13px] break-all">{r.toTarget}</TD>
                      <TD>{r.statusCode === 301 ? "Permanent" : "Temporary"}</TD>
                      <TD>{r.hitCount}</TD>
                      <TD>
                        <Toggle checked={r.active} onChange={(v) => toggleActive(r, v)} />
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Tooltip label="Edit">
                            <button
                              onClick={() => setForm({ redirect: r })}
                              aria-label={`Edit redirect from ${r.fromPath}`}
                              className={iconButton}
                            >
                              <Pencil className="size-4" />
                            </button>
                          </Tooltip>
                          <Tooltip label="Delete" align="end">
                            <button
                              onClick={() => setConfirmDelete(r)}
                              aria-label={`Delete redirect from ${r.fromPath}`}
                              className={`${iconButton} hover:text-red-600`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="mt-3 flex items-center justify-between text-sm text-text-muted">
                <span>
                  {redirects.total} of {redirects.limit} redirects used
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={redirectPage <= 1}
                    onClick={() => setRedirectPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {redirects.page} of {pageCount(redirects.total, redirects.pageSize)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={redirectPage >= pageCount(redirects.total, redirects.pageSize)}
                    onClick={() => setRedirectPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === "404" && (
        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-64">
                <Input
                  label="Search"
                  value={logSearch}
                  onChange={(e) => {
                    setLogSearch(e.target.value);
                    setLogPage(1);
                  }}
                  placeholder="Search by address"
                />
              </div>
              <div className="w-44">
                <Select
                  label="Sort by"
                  value={logSort}
                  onChange={(e) => {
                    setLogSort(e.target.value === "recent" ? "recent" : "hits");
                    setLogPage(1);
                  }}
                >
                  <option value="hits">Most requested</option>
                  <option value="recent">Most recent</option>
                </Select>
              </div>
            </div>
            <Button variant="secondary" disabled={!log || log.total === 0} onClick={() => setConfirmClear(true)}>
              Clear report
            </Button>
          </div>
          <p className="text-[13px] text-text-muted mb-3">
            This report is advisory. It is collected from visitors&apos; browsers, so treat the counts as a guide, not
            an exact figure.
          </p>
          {log === null ? (
            logError ? <LoadFailed what="the 404 report" onRetry={refreshLog} /> : <TableSkeleton rows={4} cols={5} />
          ) : log.data.length === 0 ? (
            <EmptyState
              title="No missing pages recorded"
              description="When a visitor opens an address that does not exist, it shows up here."
            />
          ) : (
            <>
              <CardList>
                {log.data.map((entry) => (
                  <CardListItem
                    key={entry.id}
                    onOpen={() => {
                      setTab("redirects");
                      setForm({ redirect: null, initialFrom: entry.path });
                    }}
                    openLabel={`Create redirect from ${entry.path}`}
                    actions={
                      <CardRowMenu
                        label={`More actions for ${entry.path}`}
                        items={[
                          {
                            label: "Create redirect",
                            icon: <ArrowRightLeft className="size-3.5" />,
                            onClick: () => {
                              setTab("redirects");
                              setForm({ redirect: null, initialFrom: entry.path });
                            },
                          },
                          { label: "Dismiss", icon: <Trash2 className="size-3.5" />, onClick: () => handleDismiss(entry.id), danger: true },
                        ]}
                      />
                    }
                  >
                    <div className="break-all font-mono text-[13px] text-text-primary dark:text-zinc-100">
                      {entry.path}
                      {entry.hasRedirect && (
                        <span className="ms-2 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-accent-tint text-accent-text">Has redirect</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {entry.hitCount} request{entry.hitCount === 1 ? "" : "s"} · last seen {formatDate(entry.lastSeenAt)}
                    </div>
                  </CardListItem>
                ))}
              </CardList>
              <Table className="hidden md:block">
                <THead>
                  <TR>
                    <TH>Address</TH>
                    <TH className="w-24">Requests</TH>
                    <TH>Last seen</TH>
                    <TH>Came from</TH>
                    <TH className="w-24 text-end">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {log.data.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="font-mono text-[13px] break-all">
                        {entry.path}
                        {entry.hasRedirect && (
                          <span className="ms-2 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-accent-tint text-accent-text">
                            Has redirect
                          </span>
                        )}
                      </TD>
                      <TD>{entry.hitCount}</TD>
                      <TD>{formatDate(entry.lastSeenAt)}</TD>
                      <TD>{entry.lastReferrer ?? "Unknown"}</TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Tooltip label="Create redirect from this">
                            <button
                              onClick={() => {
                                setTab("redirects");
                                setForm({ redirect: null, initialFrom: entry.path });
                              }}
                              aria-label={`Create redirect from ${entry.path}`}
                              className={iconButton}
                            >
                              <ArrowRightLeft className="size-4" />
                            </button>
                          </Tooltip>
                          <Tooltip label="Dismiss" align="end">
                            <button
                              onClick={() => handleDismiss(entry.id)}
                              aria-label={`Dismiss ${entry.path}`}
                              className={`${iconButton} hover:text-red-600`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="mt-3 flex items-center justify-end gap-2 text-sm text-text-muted">
                <Button variant="secondary" disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {log.page} of {pageCount(log.total, log.pageSize)}
                </span>
                <Button
                  variant="secondary"
                  disabled={logPage >= pageCount(log.total, log.pageSize)}
                  onClick={() => setLogPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {form && (
        <UrlRedirectFormModal
          redirect={form.redirect}
          initialFrom={form.initialFrom}
          onClose={() => setForm(null)}
          onSaved={() => {
            refreshRedirects();
            refreshLog();
          }}
        />
      )}

      {importing && (
        <UrlRedirectImportModal
          onClose={() => setImporting(false)}
          onImported={() => {
            refreshRedirects();
            refreshLog();
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(null)}
          size="sm"
          title="Delete redirect?"
          footer={(requestClose) => (
            <>
              <Button variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} disabled={busy} onClick={() => handleDelete(confirmDelete)}>
                Delete
              </Button>
            </>
          )}
        >
          <p className="text-sm">
            Visitors to <span className="font-mono">{confirmDelete.fromPath}</span> will see a not-found page again.
          </p>
        </Modal>
      )}

      {confirmClear && (
        <Modal
          onClose={() => setConfirmClear(false)}
          size="sm"
          title="Clear the 404 report?"
          footer={(requestClose) => (
            <>
              <Button variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} disabled={busy} onClick={handleClear}>
                Clear report
              </Button>
            </>
          )}
        >
          <p className="text-sm">Every recorded missing address is removed. They come back if visitors request them again.</p>
        </Modal>
      )}
    </PageShell>
  );
}
