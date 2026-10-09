"use client";

import { useEffect, useState } from "react";
import { getCustomerConsent, recordCustomerConsent } from "@/lib/api";
import type { ConsentChannel, ConsentStatus, CustomerConsent } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import LoadFailed from "@/components/ui/LoadFailed";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const CHANNEL_LABEL: Record<ConsentChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

const SOURCE_LABEL: Record<string, string> = {
  admin: "Recorded by staff",
  storefront_account: "Customer account",
  account_deletion: "Account deleted",
};

function statusText(status: ConsentStatus | null): string {
  if (status === "granted") return "Agreed";
  if (status === "withdrawn") return "Withdrawn";
  // Unknown is not "no": nobody has been asked, or nobody recorded the answer.
  return "Not asked";
}

// CUS-11. Marketing consent per channel, with the full history underneath. An
// answer is only ever recorded by staff (with how it was obtained) or by the
// customer themselves; an import or a guest checkout leaves it "Not asked".
export default function CustomerConsentCard({ customerId, canEdit }: { customerId: number; canEdit: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<CustomerConsent | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [granting, setGranting] = useState<ConsentChannel | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getCustomerConsent(customerId)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [customerId, tick]);

  async function save(channel: ConsentChannel, status: ConsentStatus, evidence?: string) {
    setBusy(true);
    try {
      setData(await recordCustomerConsent(customerId, { channel, status, note: evidence }));
      setGranting(null);
      setNote("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save consent", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">Marketing consent</h2>
      <p className="mb-3 text-xs text-text-faint">
        Only an answer someone recorded counts. Orders, imports and guest checkout never imply consent.
      </p>
      {error && data === null ? (
        <LoadFailed
          what="consent"
          onRetry={() => {
            setError(false);
            setTick((t) => t + 1);
          }}
        />
      ) : data === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border dark:divide-white/10">
            {data.channels.map((c) => (
              <li key={c.channel} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{CHANNEL_LABEL[c.channel]}</div>
                    <div className="text-xs text-text-faint">
                      {statusText(c.status)}
                      {c.updatedAt && ` · ${new Date(c.updatedAt).toLocaleDateString()}`}
                      {c.source && ` · ${SOURCE_LABEL[c.source] ?? c.source}`}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      {c.status !== "granted" && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setGranting(c.channel)}>
                          Record consent
                        </Button>
                      )}
                      {c.status === "granted" && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(c.channel, "withdrawn")}>
                          Withdraw
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {granting === c.channel && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <Input
                        label="How was consent obtained?"
                        value={note}
                        maxLength={500}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="For example: verbal, in store"
                      />
                    </div>
                    <Button size="sm" disabled={busy || !note.trim()} onClick={() => void save(c.channel, "granted", note.trim())}>
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setGranting(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-faint">
            Newsletter widget:{" "}
            {data.newsletter.subscribed
              ? `subscribed${data.newsletter.since ? ` since ${new Date(data.newsletter.since).toLocaleDateString()}` : ""}`
              : "not subscribed"}
            . This list is kept separately and is not counted above.
          </p>
          {data.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-text-secondary">History ({data.history.length})</summary>
              <ul className="mt-2 space-y-2">
                {data.history.map((e) => (
                  <li key={e.id} className="text-xs text-text-faint">
                    <span className="font-medium text-text-secondary">
                      {CHANNEL_LABEL[e.channel]} {e.status === "granted" ? "agreed" : "withdrawn"}
                    </span>{" "}
                    · {new Date(e.createdAt).toLocaleString()} · {SOURCE_LABEL[e.source] ?? e.source}
                    {e.actorName ? ` (${e.actorName})` : ""}
                    {e.note ? ` · ${e.note}` : ""}
                    {e.wordingVersion ? ` · wording ${e.wordingVersion}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
