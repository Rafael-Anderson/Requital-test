"use client";

import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import ChangePasswordModal from "./ChangePasswordModal";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { isDark, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.name || user.email).charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-full bg-text-primary text-white dark:bg-white dark:text-black text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-border dark:border-white/10 bg-surface dark:bg-zinc-900 shadow-lg shadow-black/10 py-1.5 z-50"
        >
          <div className="px-3.5 py-2.5 border-b border-border dark:border-white/10">
            <p className="text-sm font-medium truncate">{user.name}</p>
            {user.shopName && <p className="text-xs text-text-muted truncate">{user.shopName}</p>}
          </div>

          <div className="px-3.5 py-2.5 border-b border-border dark:border-white/10">
            <p className="text-xs font-medium text-text-faint uppercase tracking-wide mb-1.5">Language</p>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between rounded px-1.5 py-1 text-sm">
                <span>🇬🇧 English</span>
                <Check className="size-3.5 text-accent-text dark:text-accent" />
              </div>
              <div className="flex items-center justify-between rounded px-1.5 py-1 text-sm text-text-faint cursor-not-allowed">
                <span>🇦🇪 Arabic</span>
                <span className="text-xs">Coming soon</span>
              </div>
            </div>
          </div>

          <div className="px-3.5 py-2.5 border-b border-border dark:border-white/10">
            <p className="text-xs font-medium text-text-faint uppercase tracking-wide mb-1.5">Theme</p>
            <SegmentedToggle
              value={isDark ? "dark" : "light"}
              onChange={(v) => setTheme(v === "dark")}
              options={[
                { value: "light", label: "☀️ Light" },
                { value: "dark", label: "🌙 Dark" },
              ]}
            />
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <KeyRound className="size-3.5" />
            Change password
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      )}

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
