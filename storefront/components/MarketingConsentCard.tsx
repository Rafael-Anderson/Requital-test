"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { getMyConsent, setMyConsent } from "@/lib/api";
import type { ConsentChannel, MyConsent } from "@/lib/types";

const CHANNEL_LABEL: Record<ConsentChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "Text message (SMS)",
};

// The customer's own marketing preferences (CUS-11). Nothing is pre-ticked: a
// customer who has never answered sees every box empty and is subscribed to
// nothing. The sentence next to each box comes from the server together with its
// version, and the server stamps both onto the record, so what is stored is what
// was shown here.
export default function MarketingConsentCard() {
  const { shopSlug } = useShop();
  const [data, setData] = useState<MyConsent | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<ConsentChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyConsent(shopSlug)
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [shopSlug]);

  async function toggle(channel: ConsentChannel, granted: boolean) {
    setBusy(channel);
    setError(null);
    try {
      const res = await setMyConsent(shopSlug, channel, granted);
      setData((d) => (d ? { ...d, channels: res.channels } : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your choice");
    } finally {
      setBusy(null);
    }
  }

  if (failed) return null;
  if (!data) return null;

  return (
    <div className="rounded-lg border border-black/10 p-4 space-y-3">
      <div>
        <p className="font-medium">Marketing messages</p>
        <p className="text-sm text-zinc-500">Choose what you would like to hear about. You can change this at any time.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-3">
        {data.channels.map((c) => (
          <li key={c.channel}>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 size-4 cursor-pointer"
                checked={c.status === "granted"}
                disabled={busy === c.channel}
                onChange={(e) => void toggle(c.channel, e.target.checked)}
              />
              <span>
                <span className="font-medium">{CHANNEL_LABEL[c.channel]}</span>
                <span className="block text-zinc-500">{data.wording.channels[c.channel]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
