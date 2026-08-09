"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { exportMyData, updateMyProfile } from "@/lib/api";
import { sanitizePhoneInput } from "@/lib/phone";
import { FIELD_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_OUTLINE_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import DeleteAccountModal from "@/components/DeleteAccountModal";

export default function AccountDashboardPage() {
  const router = useRouter();
  const { shopSlug } = useShop();
  const { customer, loading, logout, refreshProfile } = useAuth();

  useEffect(() => {
    if (!loading && !customer) router.replace(`/${shopSlug}/account/login`);
  }, [loading, customer, shopSlug, router]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  function startEditing() {
    if (!customer) return;
    setName(customer.name);
    setEmail(customer.email ?? "");
    setPhone(customer.phone);
    setEditing(true);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateMyProfile(shopSlug, { name, email: email || undefined, phone });
      await refreshProfile();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.push(`/${shopSlug}`);
  }

  // Fetched via an authenticated JS fetch (not a plain <a href>, which
  // can't attach the bearer token) then turned into a Blob download
  // client-side — same pattern as OrderDetailPage's invoice download.
  async function handleDownloadData() {
    setExporting(true);
    setExportError(null);
    try {
      const data = await exportMyData(shopSlug);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-data.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to download your data");
    } finally {
      setExporting(false);
    }
  }

  async function handleAccountDeleted() {
    setShowDeleteModal(false);
    await logout();
    router.push(`/${shopSlug}`);
  }

  if (loading || !customer) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  return (
    <StorefrontPageShell variant="medium" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My account</h1>
        <button onClick={handleLogout} className={`h-9 px-3 rounded-lg text-sm cursor-pointer ${BUTTON_OUTLINE_CLASS}`}>
          Sign out
        </button>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
        {!editing ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Name</span>
              <span>{customer.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Phone</span>
              <span>{customer.phone}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Email</span>
              <span>{customer.email ?? "-"}</span>
            </div>
            <button
              type="button"
              onClick={startEditing}
              className={`mt-2 h-9 px-3 rounded-lg text-sm cursor-pointer ${BUTTON_OUTLINE_CLASS}`}
            >
              Edit profile
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Phone</label>
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD_CLASS} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className={BUTTON_PRIMARY_CLASS}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={`h-10 px-4 rounded-lg text-sm cursor-pointer ${BUTTON_OUTLINE_CLASS}`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/${shopSlug}/account/orders`}
          className="rounded-lg border border-black/10 dark:border-white/10 p-4 hover:border-accent/50 transition-colors"
        >
          <p className="font-medium">Order history</p>
          <p className="text-sm text-zinc-500">View your past orders</p>
        </Link>
        <Link
          href={`/${shopSlug}/account/addresses`}
          className="rounded-lg border border-black/10 dark:border-white/10 p-4 hover:border-accent/50 transition-colors"
        >
          <p className="font-medium">Saved addresses</p>
          <p className="text-sm text-zinc-500">Manage delivery addresses</p>
        </Link>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <div>
          <p className="font-medium">Privacy</p>
          <p className="text-sm text-zinc-500">Download or delete the personal data we hold about you.</p>
        </div>
        {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleDownloadData}
            disabled={exporting}
            className={`h-9 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50 ${BUTTON_OUTLINE_CLASS}`}
          >
            {exporting ? "Preparing…" : "Download my data"}
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="h-9 px-3 rounded-lg text-sm cursor-pointer text-red-600 border border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Delete my account
          </button>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteAccountModal
          shopSlug={shopSlug}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={handleAccountDeleted}
        />
      )}
    </StorefrontPageShell>
  );
}
