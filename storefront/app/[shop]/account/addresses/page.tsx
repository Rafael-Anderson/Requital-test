"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { createMyAddress, deleteMyAddress, listMyAddresses, updateMyAddress } from "@/lib/api";
import { EMIRATES } from "@/lib/types";
import type { CustomerAddress } from "@/lib/types";
import { FIELD_CLASS, TEXTAREA_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_OUTLINE_CLASS } from "@/lib/form-styles";
import StorefrontPageShell from "@/components/StorefrontPageShell";

interface AddressFormState {
  label: string;
  address: string;
  emirate: string;
  area: string;
}

const EMPTY_FORM: AddressFormState = { label: "", address: "", emirate: EMIRATES[1], area: "" };

export default function AddressesPage() {
  const router = useRouter();
  const { shopSlug } = useShop();
  const { customer, loading: authLoading } = useAuth();

  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !customer) router.replace(`/${shopSlug}/account/login`);
  }, [authLoading, customer, shopSlug, router]);

  function refresh() {
    return listMyAddresses(shopSlug)
      .then(setAddresses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load addresses"));
  }

  useEffect(() => {
    if (customer) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopSlug, customer]);

  function startNew() {
    setForm(EMPTY_FORM);
    setEditingId("new");
  }

  function startEdit(address: CustomerAddress) {
    setForm({ label: address.label ?? "", address: address.address, emirate: address.emirate, area: address.area ?? "" });
    setEditingId(address.id);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { label: form.label || undefined, address: form.address, emirate: form.emirate, area: form.area || undefined };
      if (editingId === "new") {
        await createMyAddress(shopSlug, payload);
      } else if (editingId) {
        await updateMyAddress(shopSlug, editingId, payload);
      }
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this address");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMyAddress(shopSlug, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this address");
    }
  }

  if (authLoading || !customer) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  return (
    <StorefrontPageShell variant="medium">
      <Link href={`/${shopSlug}/account`} className="text-sm text-zinc-500 hover:text-accent mb-3 inline-block">
        ← Back to account
      </Link>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Saved addresses</h1>
        {editingId === null && (
          <button onClick={startNew} className={`h-9 px-3 rounded-lg text-sm cursor-pointer ${BUTTON_OUTLINE_CLASS}`}>
            + Add address
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {editingId !== null && (
        <form onSubmit={handleSave} className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3 mb-4">
          <div>
            <label className="text-sm font-medium block mb-1">Label (optional)</label>
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Home, Office"
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Address</label>
            <textarea
              required
              rows={2}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className={TEXTAREA_CLASS}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Emirate</label>
              <select
                value={form.emirate}
                onChange={(e) => setForm((f) => ({ ...f, emirate: e.target.value }))}
                className={FIELD_CLASS}
              >
                {EMIRATES.map((em) => (
                  <option key={em} value={em}>
                    {em}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Area (optional)</label>
              <input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} className={FIELD_CLASS} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className={BUTTON_PRIMARY_CLASS}>
              {saving ? "Saving…" : "Save address"}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className={`h-10 px-4 rounded-lg text-sm cursor-pointer ${BUTTON_OUTLINE_CLASS}`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {addresses?.length === 0 && editingId === null && (
          <p className="text-zinc-500">No saved addresses yet.</p>
        )}
        {addresses?.map((a) => (
          <div key={a.id} className="rounded-lg border border-black/10 dark:border-white/10 p-4 flex justify-between gap-3">
            <div className="min-w-0">
              {a.label && <p className="font-medium">{a.label}</p>}
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{a.address}</p>
              <p className="text-xs text-zinc-500">
                {a.area ? `${a.area}, ` : ""}
                {a.emirate}
              </p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => startEdit(a)} className="text-xs text-accent hover:underline cursor-pointer">
                Edit
              </button>
              <button onClick={() => handleDelete(a.id)} className="text-xs text-red-600 hover:underline cursor-pointer">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </StorefrontPageShell>
  );
}
