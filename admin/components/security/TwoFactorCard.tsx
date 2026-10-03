"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { TwoFactorStatus } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

// The two tiers (merchant staff, platform admin) have identical flows over
// different endpoints, so the card takes the calls as an adapter.
export interface TwoFactorAdapter {
  getStatus: () => Promise<TwoFactorStatus>;
  start: (currentPassword: string) => Promise<{ secret: string; otpauthUri: string }>;
  confirm: (code: string) => Promise<{ recoveryCodes: string[] }>;
  disable: (code: string) => Promise<unknown>;
  regenerate: (currentPassword: string, code: string) => Promise<{ recoveryCodes: string[] }>;
}

type Mode = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// Recovery codes are shown exactly once, here. Copy and download are offered
// because a screenshot is the thing people actually do.
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const text = codes.join("\n");
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Save these recovery codes somewhere safe. Each works once if you lose your device. They are
        shown only now and cannot be viewed again.
      </p>
      <ul className="grid grid-cols-1 gap-1 rounded-lg border border-border p-3 font-mono text-sm sm:grid-cols-2" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => toast("Recovery codes copied"));
          }}
        >
          Copy
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "requital-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <Button variant="primary" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  );
}

export default function TwoFactorCard({
  adapter,
  onChanged,
  subject = "your account",
}: {
  adapter: TwoFactorAdapter;
  // Called after enrolling or turning it off, so callers can refresh their session state.
  onChanged?: () => void;
  subject?: string;
}) {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    adapter
      .getStatus()
      .then((s) => alive && setStatus(s))
      .catch((err) => alive && toast(errorText(err, "Failed to load two-factor status"), "error"));
    return () => {
      alive = false;
    };
  }, [adapter, reload, toast]);

  function reset(next: Mode = "idle") {
    setMode(next);
    setPassword("");
    setCode("");
    setError(null);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const onStart = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      setSetup(await adapter.start(password));
      reset("scan");
    });
  };
  const onConfirm = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await adapter.confirm(code.trim());
      setCodes(res.recoveryCodes);
      setSetup(null);
      reset("codes");
      setReload((n) => n + 1);
      onChanged?.();
    });
  };
  const onDisable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await adapter.disable(code.trim());
      toast("Two-factor turned off");
      reset();
      setReload((n) => n + 1);
      onChanged?.();
    });
  };
  const onRegenerate = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await adapter.regenerate(password, code.trim());
      setCodes(res.recoveryCodes);
      reset("codes");
      setReload((n) => n + 1);
    });
  };

  const enabled = !!status?.enabled;

  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Two-factor authentication</h2>
        <p className="mt-1 text-sm text-text-muted">
          Sign in with a 6 digit code from an authenticator app as well as your password. Resetting your
          password never turns this off.
        </p>
      </div>

      {status === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : mode === "codes" && codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            reset();
          }}
        />
      ) : mode === "password" ? (
        <form onSubmit={onStart} className="space-y-3">
          <Input
            label="Confirm your password to continue"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Continue
            </Button>
            <Button type="button" variant="secondary" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : mode === "scan" && setup ? (
        <form onSubmit={onConfirm} className="space-y-3">
          <p className="text-sm text-text-muted">
            Scan this code with your authenticator app, or enter the key by hand, then type the 6 digit code it shows.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={setup.otpauthUri} size={148} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-text-faint">Setup key</p>
              <p className="break-all font-mono text-sm" data-testid="totp-secret">
                {setup.secret}
              </p>
            </div>
          </div>
          <Input
            label="6 digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Turn on
            </Button>
            <Button type="button" variant="secondary" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : mode === "disable" ? (
        <form onSubmit={onDisable} className="space-y-3">
          <Input
            label="Current 6 digit code or a recovery code"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Turn off
            </Button>
            <Button type="button" variant="secondary" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : mode === "regenerate" ? (
        <form onSubmit={onRegenerate} className="space-y-3">
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label="Current 6 digit code or a recovery code"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Generate new codes
            </Button>
            <Button type="button" variant="secondary" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {enabled ? (
              <>
                <span className="font-semibold text-green-600">On</span> for {subject}.{" "}
                {status.recoveryCodesRemaining} recovery code{status.recoveryCodesRemaining === 1 ? "" : "s"} left.
              </>
            ) : (
              <>
                <span className="font-semibold">Off</span> for {subject}.
                {status.required && " Required, so you need to set it up to continue."}
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <Button variant="secondary" onClick={() => reset("regenerate")}>
                  New recovery codes
                </Button>
                {!status.required && (
                  <Button variant="secondary" onClick={() => reset("disable")}>
                    Turn off
                  </Button>
                )}
              </>
            ) : (
              <Button variant="primary" onClick={() => reset("password")}>
                Set up
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
