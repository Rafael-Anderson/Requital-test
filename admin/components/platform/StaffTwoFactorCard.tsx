"use client";

import { useEffect, useState } from "react";
import {
  listPlatformShopUsers,
  resetShopUserTwoFactor,
  type PlatformShopUser,
  type PlatformShopUsers,
} from "@/lib/platform-api";
import { CardList } from "@/components/ui/CardList";
import LoadFailed from "@/components/ui/LoadFailed";
import { useToast } from "@/components/ui/Toast";

// Support-only recovery for a shop user who lost their device AND their
// recovery codes (a sole shop admin has nobody else who can reset them). The
// confirm states what the reset does and reminds support to verify the person
// first; docs/runbook.md has the full checklist.
export function confirmResetTwoFactor(user: Pick<PlatformShopUser, "name" | "email">): boolean {
  return window.confirm(
    `Reset two-factor for ${user.name} (${user.email})?\n\n` +
      "Only do this after you have verified who is asking, out of band (see the runbook checklist).\n\n" +
      "This removes their authenticator and recovery codes, signs them out everywhere, " +
      "and makes them set up two-factor again before they can use the admin. " +
      "They are emailed. It is recorded in the audit log.",
  );
}

function status(u: PlatformShopUser): { label: string; tone: string } {
  if (u.mfaEnrolled) return { label: "Enrolled", tone: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" };
  if (u.mustEnrol2fa) return { label: "Must set up again", tone: "border-amber-500/30 bg-amber-500/15 text-amber-400" };
  return { label: "Not set up", tone: "border-slate-600 bg-slate-700/40 text-slate-400" };
}

function lastSignIn(u: PlatformShopUser): string {
  return u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "Never";
}

export default function StaffTwoFactorCard({ shopId }: { shopId: number }) {
  const toast = useToast();
  const [data, setData] = useState<PlatformShopUsers | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [resetting, setResetting] = useState<number | null>(null);

  useEffect(() => {
    // `stale` drops an answer that arrives after the shop changed or a retry started.
    let stale = false;
    listPlatformShopUsers(shopId)
      .then((d) => {
        if (stale) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [shopId, nonce]);

  function retry() {
    setFailed(false);
    setData(null);
    setNonce((n) => n + 1);
  }

  async function reset(user: PlatformShopUser) {
    if (!confirmResetTwoFactor(user)) return;
    setResetting(user.id);
    try {
      await resetShopUserTwoFactor(shopId, user.id);
      toast(`Two-factor reset for ${user.name}. They have been emailed.`);
      setNonce((n) => n + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not reset two-factor", "error");
    } finally {
      setResetting(null);
    }
  }

  const resetButton = (u: PlatformShopUser) => (
    <button
      type="button"
      onClick={() => void reset(u)}
      disabled={resetting !== null}
      aria-label={`Reset two-factor for ${u.name}`}
      className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
    >
      {resetting === u.id ? "Resetting..." : "Reset two-factor"}
    </button>
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">Staff two-factor</h2>
      <p className="mb-3 text-xs text-slate-500">
        For a shop user who lost their device and recovery codes. Verify the person out of band before you press
        Reset. It signs them out everywhere and they must set up two-factor again.
        {data?.shopRequires2fa ? " This shop requires two-factor for all staff." : ""}
      </p>
      {failed ? (
        <LoadFailed what="staff" onRetry={retry} />
      ) : !data ? (
        <div role="status" className="text-sm text-slate-500">
          Loading staff...
        </div>
      ) : data.users.length === 0 ? (
        <div className="text-sm text-slate-500">This shop has no staff.</div>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pe-3 text-start font-semibold">Name</th>
                  <th className="py-2 pe-3 text-start font-semibold">Role</th>
                  <th className="py-2 pe-3 text-start font-semibold">Two-factor</th>
                  <th className="py-2 pe-3 text-start font-semibold">Last sign-in</th>
                  <th className="py-2 text-end font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.users.map((u) => {
                  const st = status(u);
                  return (
                    <tr key={u.id}>
                      <td className="py-2.5 pe-3">
                        <div className="text-slate-200">{u.name}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-2.5 pe-3 text-slate-300">
                        {u.role}
                        {u.outletName ? <span className="text-slate-500"> / {u.outletName}</span> : null}
                      </td>
                      <td className="py-2.5 pe-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
                      </td>
                      <td className="py-2.5 pe-3 text-slate-400">{lastSignIn(u)}</td>
                      <td className="py-2.5 text-end">{resetButton(u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <CardList>
            {data.users.map((u) => {
              const st = status(u);
              return (
                <li key={u.id} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">{u.name}</div>
                    <div className="truncate text-xs text-slate-500">{u.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{u.role}</span>
                    <span className={`rounded-full border px-2 py-0.5 font-semibold ${st.tone}`}>{st.label}</span>
                    <span>Last sign-in: {lastSignIn(u)}</span>
                  </div>
                  {resetButton(u)}
                </li>
              );
            })}
          </CardList>
        </>
      )}
    </div>
  );
}
