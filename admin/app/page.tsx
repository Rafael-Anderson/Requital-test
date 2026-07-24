"use client";

import Link from "next/link";
import { LayoutDashboard, ClipboardList, Package, FolderTree, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const SECTIONS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/categories", label: "Categories", icon: FolderTree },
];

// Admin-only, same role check used for the TopBar "Manage branches" link —
// a branch account never sees the tile, and every settings endpoint behind
// it is independently @Roles('admin')-gated server-side regardless.
const ADMIN_SECTIONS = [{ href: "/settings", label: "Settings", icon: Settings }];

export default function HomePage() {
  const { user } = useAuth();
  const sections = user?.role === "admin" ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;

  return (
    <div className="page-transition">
      <h1 className="text-2xl font-semibold mb-6">Requital</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl">
        {sections.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center justify-center gap-3 border rounded-lg p-6 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Icon className="size-8" strokeWidth={1.5} />
            <span className="text-sm font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
