"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import { AUTH_CARD_CLASS, AUTH_HEADING_CLASS, BUTTON_PRIMARY_CLASS } from "@/lib/form-styles";

interface Props {
  heading: string;
  // Read only: must never change anything (mail scanners open links).
  lookup: (token: string) => Promise<{ shopName: string; confirmed?: boolean }>;
  // The state change, only ever run from the button.
  act: (token: string) => Promise<unknown>;
  prompt: (shopName: string) => string;
  button: string;
  working: string;
  done: (shopName: string) => string;
  // Shown instead of the button when the lookup says it is already done.
  alreadyDone?: (shopName: string) => string;
}

function Content({ heading, lookup, act, prompt, button, working, done, alreadyDone }: Props) {
  const token = useSearchParams().get("token") ?? "";
  const [shopName, setShopName] = useState<string | null>(null);
  const [already, setAlready] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "done" | "invalid" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    let live = true;
    lookup(token)
      .then((r) => {
        if (!live) return;
        setShopName(r.shopName);
        setAlready(r.confirmed === true);
        setState("ready");
      })
      .catch(() => live && setState("invalid"));
    return () => {
      live = false;
    };
    // lookup is a stable module function per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);

  async function run() {
    setState("busy");
    try {
      await act(token);
      setState("done");
    } catch {
      setState("failed");
    }
  }

  return (
    <StorefrontPageShell variant="narrow">
      <div className={AUTH_CARD_CLASS}>
        <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>{heading}</h1>
        {state === "loading" && <p className="text-sm text-zinc-500">Loading...</p>}
        {state === "invalid" && <p className="text-sm">This link is not valid or has expired.</p>}
        {state === "ready" && already && alreadyDone && <p role="status" className="text-sm">{alreadyDone(shopName ?? "")}</p>}
        {state === "ready" && !(already && alreadyDone) && (
          <div className="space-y-4">
            <p className="text-sm">{prompt(shopName ?? "")}</p>
            <button type="button" onClick={run} className={`min-h-11 px-4 rounded-lg font-medium cursor-pointer ${BUTTON_PRIMARY_CLASS}`}>
              {button}
            </button>
          </div>
        )}
        {state === "busy" && <p className="text-sm text-zinc-500">{working}</p>}
        {state === "done" && <p role="status" className="text-sm">{done(shopName ?? "")}</p>}
        {state === "failed" && (
          <div className="space-y-3">
            <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`min-h-11 px-4 rounded-lg font-medium cursor-pointer ${BUTTON_PRIMARY_CLASS}`}>
              Try again
            </button>
          </div>
        )}
      </div>
    </StorefrontPageShell>
  );
}

export default function EmailLinkAction(props: Props) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading...</p>}>
      <Content {...props} />
    </Suspense>
  );
}
