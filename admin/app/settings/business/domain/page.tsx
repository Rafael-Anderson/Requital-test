"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import {
  ApiError,
  getShopDomain,
  updateShopDomain,
  verifyShopDomain,
} from "@/lib/api";
import type { ShopDomainConfig } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import { validateCustomDomain, normalizeCustomDomain } from "@/lib/validators";

// While a claim is pending/verifying, re-fetch on this cadence so a
// sweep-driven transition (the backend rechecks every ~5 min on its own)
// shows up without the merchant refreshing. Same "just poll" approach as the
// orders list. Stops the moment status is verified/failed or the page unmounts.
const POLL_MS = 15_000;

const CONFLICT_MESSAGE = "This domain is connected to another account.";

// ponytail: local, not a shared component — the admin's copy-to-clipboard is
// an inline navigator.clipboard + local `copied` state in ~8 places, no shared
// widget. Extract to components/ui/ if a later phase needs it elsewhere.
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div>
      <p className="text-xs font-semibold text-text-faint mb-1">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 break-all rounded-lg bg-neutral-chip-bg dark:bg-zinc-800 px-3 py-2 text-[13px] text-text-primary dark:text-zinc-100">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border dark:border-white/15 px-3 text-xs font-semibold text-text-secondary dark:text-zinc-300 hover:bg-page dark:hover:bg-white/10"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function StoreLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text dark:text-accent hover:underline"
    >
      {url.replace(/^https?:\/\//, "")}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

export default function DomainSettingsPage() {
  const toast = useToast();
  const [config, setConfig] = useState<ShopDomainConfig | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const refresh = useCallback(async () => {
    setConfig(await getShopDomain());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll only while a verification is in flight.
  const polling = config?.status === "pending" || config?.status === "verifying";
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      // Swallow errors — a transient failure shouldn't blow up the page; the
      // next tick (or a manual action) recovers.
      void getShopDomain().then(setConfig).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling]);

  function handleApiError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.status === 409) {
      setInputError(CONFLICT_MESSAGE);
      return;
    }
    toast(err instanceof Error ? err.message : fallback, "error");
  }

  async function connect(domain: string) {
    const trimmed = normalizeCustomDomain(domain);
    const check = validateCustomDomain(trimmed);
    if (!check.valid) {
      setInputError(check.message ?? "Enter a valid domain");
      return;
    }
    setInputError(null);
    setBusy(true);
    try {
      setConfig(await updateShopDomain({ type: "custom", customDomain: trimmed }));
      setDomainInput("");
    } catch (err) {
      handleApiError(err, "Could not connect that domain");
    } finally {
      setBusy(false);
    }
  }

  // Revert to the subdomain. `fromModal` handles the confirmed "Disconnect" on a
  // verified domain; the bare "Use my subdomain instead" links on the
  // pending/failed states call it directly.
  async function switchToSubdomain(fromModal = false) {
    setBusy(true);
    try {
      setConfig(await updateShopDomain({ type: "subdomain" }));
      toast("Your store is back on its requital.io address.");
    } catch (err) {
      handleApiError(err, "Could not switch back to your subdomain");
    } finally {
      setBusy(false);
      if (fromModal) setDisconnectOpen(false);
    }
  }

  async function verifyNow() {
    setBusy(true);
    try {
      const result = await verifyShopDomain();
      await refresh();
      if (result.verified) {
        toast("Your custom domain is verified and live.", "success");
      } else {
        toast(
          "We could not find the TXT record yet. We will keep checking, or try Verify now again in a few minutes.",
        );
      }
    } catch (err) {
      // A 409 here means the domain got verified by another account; the
      // backend has moved this claim to "failed". Reload to show that state.
      if (err instanceof ApiError && err.status === 409) {
        toast(CONFLICT_MESSAGE, "error");
        await refresh().catch(() => {});
      } else {
        toast(err instanceof Error ? err.message : "Verification failed", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <PageShell variant="form">
        <Card>
          <div className="h-40 animate-pulse rounded-lg bg-neutral-chip-bg dark:bg-zinc-800" />
        </Card>
      </PageShell>
    );
  }

  const isCustom = config.type === "custom";
  const status = config.status;

  return (
    <PageShell variant="form">
      <div className="space-y-4">
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent-tint text-accent dark:bg-accent/15 shrink-0">
              <Globe className="size-[18px]" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
                Store address
              </h2>
              <p className="text-xs text-text-faint mt-1 max-w-md">
                Your store is always reachable at its requital.io subdomain. You can
                also connect your own domain.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border dark:border-white/10 px-3.5 py-3">
            <p className="text-xs font-semibold text-text-faint mb-1">
              requital.io subdomain
            </p>
            <StoreLink url={`https://${config.subdomain}.requital.io`} />
          </div>
        </Card>

        {/* Subdomain-only: offer to connect a custom domain. */}
        {!isCustom && (
          <Card className="space-y-3">
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
              Connect a custom domain
            </h3>
            <p className="text-xs text-text-faint">
              Enter a domain you own, like shop.yourbrand.com or yourbrand.com. You
              will add one DNS record to prove it is yours.
            </p>
            <form
              className="flex flex-col sm:flex-row sm:items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void connect(domainInput);
              }}
            >
              <Input
                label="Custom domain"
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="shop.yourbrand.com"
                wrapperClassName="flex-1"
                error={inputError ?? undefined}
              />
              <Button type="submit" variant="primary" loading={busy}>
                Connect
              </Button>
            </form>
          </Card>
        )}

        {/* Pending / verifying: show the DNS record + Verify now. */}
        {isCustom && (status === "pending" || status === "verifying") && (
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
                Verifying {config.customDomain}
              </h3>
              <span className="shrink-0 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 px-2.5 py-1 text-[11.5px] font-bold">
                {status === "verifying" ? "Checking" : "Pending"}
              </span>
            </div>

            <p className="text-sm text-text-secondary dark:text-zinc-300">
              Add this TXT record in your domain&apos;s DNS settings. Once it is live
              we will verify it automatically, or use Verify now to check straight
              away.
            </p>

            {config.verification && (
              <div className="space-y-3 rounded-lg border border-border dark:border-white/10 p-3.5">
                <div>
                  <p className="text-xs font-semibold text-text-faint mb-1">Type</p>
                  <code className="rounded-lg bg-neutral-chip-bg dark:bg-zinc-800 px-3 py-2 text-[13px] text-text-primary dark:text-zinc-100">
                    TXT
                  </code>
                </div>
                <CopyRow label="Name / Host" value={config.verification.recordName} />
                <CopyRow label="Value" value={config.verification.recordValue} />
              </div>
            )}

            <p className="text-xs text-text-faint">
              DNS changes usually take a few minutes, but can take a few hours to
              take effect.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={() => void verifyNow()}>
                Verify now
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void switchToSubdomain()}
              >
                Use my subdomain instead
              </Button>
            </div>
          </Card>
        )}

        {/* Verified: live, with Disconnect. */}
        {isCustom && status === "verified" && (
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
                Custom domain is live
              </h3>
              <span className="shrink-0 rounded-full bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 px-2.5 py-1 text-[11.5px] font-bold">
                Verified
              </span>
            </div>
            <div className="rounded-lg border border-border dark:border-white/10 px-3.5 py-3">
              <p className="text-xs font-semibold text-text-faint mb-1">
                Your store is live at
              </p>
              <StoreLink url={config.storefrontUrl} />
            </div>
            <Button variant="danger" disabled={busy} onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </Card>
        )}

        {/* Failed: 48h window elapsed with no matching record. */}
        {isCustom && status === "failed" && (
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
                Could not verify {config.customDomain}
              </h3>
              <span className="shrink-0 rounded-full bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 px-2.5 py-1 text-[11.5px] font-bold">
                Failed
              </span>
            </div>
            <p className="text-sm text-text-secondary dark:text-zinc-300">
              We checked for the TXT record for two days without finding it. Confirm
              the record below is in your DNS, then retry. Retrying issues a new
              value, so update the record if you had one in place.
            </p>

            {config.verification && (
              <div className="space-y-3 rounded-lg border border-border dark:border-white/10 p-3.5">
                <CopyRow label="Name / Host" value={config.verification.recordName} />
                <CopyRow label="Value" value={config.verification.recordValue} />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void connect(config.customDomain ?? "")}
              >
                Retry verification
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void switchToSubdomain()}
              >
                Use my subdomain instead
              </Button>
            </div>
          </Card>
        )}
      </div>

      {disconnectOpen && (
        <Modal
          title="Disconnect custom domain?"
          size="sm"
          onClose={() => setDisconnectOpen(false)}
          footer={(requestClose) => (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={requestClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void switchToSubdomain(true)}>
                Disconnect
              </Button>
            </div>
          )}
        >
          <p className="text-sm text-text-secondary dark:text-zinc-300">
            {config.customDomain} will stop serving your store. It will go back to{" "}
            <span className="font-semibold">
              {config.subdomain}.requital.io
            </span>
            . You can reconnect the domain later.
          </p>
        </Modal>
      )}
    </PageShell>
  );
}
