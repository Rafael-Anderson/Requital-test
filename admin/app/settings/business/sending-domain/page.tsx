"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import {
  ApiError,
  deleteSendingDomain,
  getSendingDomain,
  putSendingDomain,
  verifySendingDomain,
} from "@/lib/api";
import type { SendingDomain } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import SettingsContentSkeleton, { SettingsLoadFailed } from "@/components/SettingsContentSkeleton";

// While a claim is in flight the backend rechecks on its own; poll so a
// sweep-driven change shows without a refresh. Stops when verified/failed.
const POLL_MS = 15_000;

const BADGE: Record<SendingDomain["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
  verifying: { label: "Checking", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
  verified: { label: "Verified", cls: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400" },
};

// ponytail: local copy button, same reasoning as the Domain page's CopyRow.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`Copy ${label}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border dark:border-white/15 px-2.5 py-1 text-xs font-semibold text-text-secondary dark:text-zinc-300 hover:bg-page dark:hover:bg-white/10"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function SendingDomainSettingsPage() {
  const toast = useToast();
  // undefined = not loaded yet, null = loaded and none set.
  const [current, setCurrent] = useState<SendingDomain | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = useCallback(() => {
    getSendingDomain()
      .then((r) => {
        setCurrent(r.sendingDomain);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load the sending domain"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const polling = current?.status === "pending" || current?.status === "verifying";
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      void getSendingDomain()
        .then((r) => setCurrent(r.sendingDomain))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling]);

  function fail(err: unknown, fallback: string) {
    // 400 (invalid domain), 403 (email not verified) and 409 (taken) are about
    // what was typed: keep them next to the field where they stay readable.
    if (err instanceof ApiError && [400, 403, 409].includes(err.status)) {
      setInputError(err.message);
      return;
    }
    toast(err instanceof Error ? err.message : fallback, "error");
  }

  async function save(domain: string) {
    const trimmed = domain.trim();
    if (!trimmed) {
      setInputError("Enter a domain you own, such as mail.yourbrand.com.");
      return;
    }
    setInputError(null);
    setBusy(true);
    try {
      setCurrent(await putSendingDomain(trimmed));
      setInput("");
    } catch (err) {
      fail(err, "Could not save that domain");
    } finally {
      setBusy(false);
    }
  }

  async function verifyNow() {
    setBusy(true);
    try {
      const r = await verifySendingDomain();
      load();
      if (r.verified) toast("Your sending domain is verified.", "success");
      else toast(r.message ?? "Not verified yet. Try again in a few minutes.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(err.message, "error");
        load();
      } else {
        toast(err instanceof Error ? err.message : "Verification failed", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteSendingDomain();
      setCurrent(null);
      toast("Sending domain removed. Emails go out from the Requital address again.");
      setRemoveOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the sending domain", "error");
    } finally {
      setBusy(false);
    }
  }

  if (current === undefined) {
    return (
      <PageShell variant="form">
        {loadError ? <SettingsLoadFailed what="the sending domain" onRetry={load} /> : <SettingsContentSkeleton cards={1} />}
      </PageShell>
    );
  }

  return (
    <PageShell variant="form">
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent dark:bg-accent/15 shrink-0">
              <Mail className="size-[18px]" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Sending domain</h2>
              <p className="text-xs text-text-faint mt-1 max-w-md">
                Send customer emails (order confirmations, delivery codes, receipts) from your own
                domain. Replies go to your shop email. Until the domain is verified, emails keep
                going out from the Requital address, so nothing is lost.
              </p>
            </div>
          </div>
        </Card>

        {!current && (
          <Card className="space-y-3">
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Add your domain</h3>
            <p className="text-xs text-text-faint">
              Use a domain you own, like yourbrand.com or mail.yourbrand.com. Free mailbox domains
              such as gmail.com are not allowed. Emails are sent from noreply@ your domain.
            </p>
            <form
              className="flex flex-col sm:flex-row sm:items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save(input);
              }}
            >
              <Input
                label="Domain"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="mail.yourbrand.com"
                wrapperClassName="flex-1"
                error={inputError ?? undefined}
              />
              <Button type="submit" variant="primary" loading={busy}>
                Continue
              </Button>
            </form>
          </Card>
        )}

        {current && (
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 min-w-0 break-all">
                {current.domain}
              </h3>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${BADGE[current.status].cls}`}>
                {BADGE[current.status].label}
              </span>
            </div>

            {current.status === "verified" ? (
              <p className="text-sm text-text-secondary dark:text-zinc-300">
                Customer emails are sent from <span className="font-semibold">{current.fromAddress}</span>.
              </p>
            ) : (
              <p className="text-sm text-text-secondary dark:text-zinc-300">
                {current.status === "failed"
                  ? "We could not verify these records. Check them with your DNS provider, then set the domain again to retry."
                  : "Add these records in your domain's DNS settings. We check automatically, or use Verify now to check straight away. DNS changes can take a few hours."}
              </p>
            )}

            {current.lastError && current.status !== "verified" && (
              <p className="text-xs text-red-600 dark:text-red-400">{current.lastError}</p>
            )}

            {current.records.length > 0 && (
              <Table>
                <THead>
                  <tr>
                    <TH>Type</TH>
                    <TH>Name / Host</TH>
                    <TH>Value</TH>
                    <TH>
                      <span className="sr-only">Copy</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {current.records.map((r, i) => (
                    <TR key={`${r.type}-${r.name}-${i}`}>
                      <TD>
                        <code className="text-[13px]">{r.type}</code>
                        {r.priority !== undefined && (
                          <span className="ms-1 text-xs text-text-faint">priority {r.priority}</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <code className="break-all text-[13px]">{r.name}</code>
                          <CopyButton value={r.name} label={`${r.type} name`} />
                        </div>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <code className="break-all text-[13px]">{r.value}</code>
                          <CopyButton value={r.value} label={`${r.type} value`} />
                        </div>
                      </TD>
                      <TD>{r.label ? <span className="text-xs text-text-faint">{r.label}</span> : null}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            <div className="flex flex-wrap gap-2">
              {(current.status === "pending" || current.status === "verifying") && (
                <Button variant="primary" loading={busy} onClick={() => void verifyNow()}>
                  Verify now
                </Button>
              )}
              {current.status === "failed" && (
                <Button variant="primary" loading={busy} onClick={() => void save(current.domain)}>
                  Retry verification
                </Button>
              )}
              <Button variant="danger" disabled={busy} onClick={() => setRemoveOpen(true)}>
                Remove
              </Button>
            </div>
            {inputError && <p className="text-xs text-red-600 dark:text-red-400">{inputError}</p>}
          </Card>
        )}
      </div>

      {removeOpen && current && (
        <Modal
          title="Remove sending domain?"
          size="sm"
          onClose={() => setRemoveOpen(false)}
          footer={(requestClose) => (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={requestClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                Remove
              </Button>
            </div>
          )}
        >
          <p className="text-sm text-text-secondary dark:text-zinc-300">
            Emails will go back to the Requital address. {current.domain} is released from your store.
          </p>
        </Modal>
      )}
    </PageShell>
  );
}
