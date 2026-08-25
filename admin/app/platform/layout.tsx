"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlatformAuthProvider, usePlatformAuth } from "@/lib/platform-auth-context";
import RequirePlatformAuth from "@/components/RequirePlatformAuth";

const NAV = [
  { href: "/platform/shops", label: "Shops" },
  { href: "/platform/settings", label: "Settings" },
  { href: "/platform/webhooks", label: "Webhooks" },
  { href: "/platform/audit-log", label: "Audit log" },
];

// Deliberately a completely different look from the merchant admin's TopBar
// (dark slate, not the merchant's white/teal) — the scope explicitly asks
// for "no confusion about which you're in." AppChrome.tsx/RequireAuth.tsx
// both bypass entirely for any /platform/* pathname, so this is the only
// chrome that ever wraps these pages.
function PlatformChrome({ children }: { children: React.ReactNode }) {
  const { admin, logout } = usePlatformAuth();
  const pathname = usePathname();

  if (pathname === "/platform/login") return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-amber-500/30 bg-amber-500 px-6 py-1.5 text-center text-xs font-bold tracking-wide text-black">
        PLATFORM ADMIN — this manages every shop on Requital, not one shop&apos;s own settings
      </div>
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-8 py-4">
        <div className="flex items-center gap-8">
          <span className="text-sm font-extrabold tracking-wide text-amber-400">
            REQUITAL · PLATFORM
          </span>
          <nav className="flex items-center gap-6">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-semibold transition-colors ${
                  pathname.startsWith(item.href)
                    ? "text-amber-400"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          {admin && <span>{admin.name}</span>}
          <button
            onClick={logout}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-8 py-8">{children}</main>
    </div>
  );
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlatformAuthProvider>
      <RequirePlatformAuth>
        <PlatformChrome>{children}</PlatformChrome>
      </RequirePlatformAuth>
    </PlatformAuthProvider>
  );
}
