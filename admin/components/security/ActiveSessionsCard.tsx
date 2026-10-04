"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { listSessions, revokeOtherSessions, revokeSession } from "@/lib/api";
import type { StaffSession } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { useToast } from "@/components/ui/Toast";

// A short, human label for a User-Agent string. Best effort and display-only:
// the full string is in the cell's title.
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

export default function ActiveSessionsCard() {
  const [sessions, setSessions] = useState<StaffSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Bumping this reloads the list. The load itself is a promise chain (not a
  // synchronous setState in the effect body).
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSessions()
      .then((list) => {
        if (!alive) return;
        setSessions(list);
        setLoadError(null);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "Failed to load sessions");
      });
    return () => {
      alive = false;
    };
  }, [reload, toast]);

  async function revoke(id: string) {
    setBusy(true);
    try {
      await revokeSession(id);
      toast("Signed out of that device");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to sign out", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      const { revoked } = await revokeOtherSessions();
      toast(revoked === 1 ? "Signed out of 1 other device" : `Signed out of ${revoked} other devices`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to sign out", "error");
    } finally {
      setBusy(false);
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Active sessions</h2>
          <p className="mt-1 text-sm text-text-muted">
            Where you are signed in. Signing a device out ends its access straight away.
          </p>
        </div>
        <Button variant="secondary" disabled={busy || others === 0} loading={busy} onClick={revokeOthers}>
          Sign out of all other devices
        </Button>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Device</TH>
            <TH>IP address</TH>
            <TH>Signed in</TH>
            <TH>Last active</TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {sessions === null ? (
            <tr>
              <td colSpan={5}>
                {loadError ? (
                  <LoadFailed
                    what="sessions"
                    onRetry={() => {
                      setLoadError(null);
                      refresh();
                    }}
                  />
                ) : (
                  <TableSkeleton rows={2} cols={5} />
                )}
              </td>
            </tr>
          ) : sessions.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState title="No active sessions" />
              </td>
            </tr>
          ) : (
            sessions.map((s) => (
              <TR key={s.id}>
                <TD>
                  <span title={s.userAgent ?? undefined}>{describeDevice(s.userAgent)}</span>
                  {s.current && (
                    <span className="ms-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent-text">
                      This device
                    </span>
                  )}
                </TD>
                <TD className="text-xs text-text-muted">{s.ip ?? "Unknown"}</TD>
                <TD className="text-xs text-text-muted">{new Date(s.startedAt).toLocaleString()}</TD>
                <TD className="text-xs text-text-muted">{new Date(s.lastActiveAt).toLocaleString()}</TD>
                <TD>
                  {!s.current && (
                    <button
                      type="button"
                      aria-label={`Sign out ${describeDevice(s.userAgent)}`}
                      disabled={busy}
                      onClick={() => revoke(s.id)}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    >
                      <LogOut className="size-4" />
                    </button>
                  )}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </Card>
  );
}
