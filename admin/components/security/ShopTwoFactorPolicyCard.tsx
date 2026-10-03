"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getTwoFactorStatus, setShopTwoFactorPolicy } from "@/lib/api";
import Card from "@/components/ui/Card";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

// Admin only (the page renders it for admins). Turning it ON needs your own
// two-factor to be set up first; turning it OFF asks for a current code, so a
// hijacked session cannot quietly lower the shop's protection.
export default function ShopTwoFactorPolicyCard({ ownEnabled }: { ownEnabled: boolean }) {
  const [required, setRequired] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    getTwoFactorStatus()
      .then((s) => alive && setRequired(s.required))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reload, ownEnabled]);

  async function apply(next: boolean, withCode?: string) {
    setBusy(true);
    setError(null);
    try {
      await setShopTwoFactorPolicy(next, withCode);
      toast(next ? "Two-factor is now required for all staff" : "Two-factor is no longer required");
      setConfirmingOff(false);
      setCode("");
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  const submitOff = (e: FormEvent) => {
    e.preventDefault();
    return apply(false, code.trim());
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Require two-factor for all staff</h2>
          <p className="mt-1 text-sm text-text-muted">
            Staff without two-factor can only reach this page until they set it up. Takes effect straight away,
            including for people already signed in.
            {!ownEnabled && required === false && " Set up two-factor on your own account first."}
          </p>
        </div>
        <Toggle
          checked={!!required}
          disabled={required === null || busy || (!required && !ownEnabled)}
          onChange={(next) => (next ? apply(true) : setConfirmingOff(true))}
        />
      </div>
      {confirmingOff && (
        <form onSubmit={submitOff} className="mt-4 space-y-3">
          <Input
            label="Your current 6 digit code or a recovery code"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Stop requiring it
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmingOff(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!confirmingOff && error && <InlineErrorMessage className="mt-3">{error}</InlineErrorMessage>}
    </Card>
  );
}
