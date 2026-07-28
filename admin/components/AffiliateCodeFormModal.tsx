"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createAffiliateCode, listAffiliates, updateAffiliateCode } from "@/lib/api";
import {
  AFFILIATE_CODE_STATUSES,
  COMMISSION_TYPES,
  type AffiliateCodeListItem,
  type AffiliateCodeStatus,
  type AffiliateListItem,
  type CommissionType,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

const FIELD_CLASS =
  "w-full h-10 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

// "Promotion For" is deliberately free text ("All Products" default, or
// whatever the merchant types) rather than a real product/category link —
// see the task's own scoping note.
export default function AffiliateCodeFormModal({
  affiliateCode,
  onClose,
  onSaved,
}: {
  affiliateCode: AffiliateCodeListItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [affiliates, setAffiliates] = useState<AffiliateListItem[] | null>(null);
  const [affiliateId, setAffiliateId] = useState<number | "">(affiliateCode?.affiliateId ?? "");
  const [code, setCode] = useState(affiliateCode?.code ?? "");
  const [promotionFor, setPromotionFor] = useState(affiliateCode?.promotionFor ?? "All Products");
  const [status, setStatus] = useState<AffiliateCodeStatus>(affiliateCode?.status ?? "approved");
  const [commissionType, setCommissionType] = useState<CommissionType>(affiliateCode?.commissionType ?? "percentage");
  const [commissionValue, setCommissionValue] = useState(String(affiliateCode?.commissionValue ?? 10));
  const [validFrom, setValidFrom] = useState(affiliateCode?.validFrom?.slice(0, 10) ?? "");
  const [validUntil, setValidUntil] = useState(affiliateCode?.validUntil?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!affiliateCode) {
      listAffiliates({ pageSize: 100 }).then((res) => setAffiliates(res.data));
    }
  }, [affiliateCode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || (!affiliateCode && !affiliateId)) return;
    setSaving(true);
    try {
      if (affiliateCode) {
        await updateAffiliateCode(affiliateCode.id, {
          promotionFor,
          status,
          commissionType,
          commissionValue: Number(commissionValue),
          ...(validFrom && { validFrom }),
          ...(validUntil && { validUntil }),
        });
        toast(`"${affiliateCode.code}" updated`);
      } else {
        await createAffiliateCode({
          affiliateId: Number(affiliateId),
          code,
          promotionFor,
          commissionType,
          commissionValue: Number(commissionValue),
          ...(validFrom && { validFrom }),
          ...(validUntil && { validUntil }),
        });
        toast(`"${code}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save code", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative max-h-[90vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-4">{affiliateCode ? `Edit "${affiliateCode.code}"` : "Add Referral"}</h2>

        <div className="space-y-3.5">
          {!affiliateCode && (
            <div>
              <label className="text-sm font-medium block mb-1">Affiliate</label>
              <select
                value={affiliateId}
                onChange={(e) => setAffiliateId(e.target.value ? Number(e.target.value) : "")}
                className={FIELD_CLASS}
                required
              >
                <option value="">Select an affiliate…</option>
                {affiliates?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!affiliateCode && (
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
          )}
          <Input label="Promotion For" value={promotionFor} onChange={(e) => setPromotionFor(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Commission Type</label>
              <select
                value={commissionType}
                onChange={(e) => setCommissionType(e.target.value as CommissionType)}
                className={FIELD_CLASS}
              >
                {COMMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "percentage" ? "Percentage" : "Fixed amount"}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Commission Value"
              type="number"
              min="0"
              step="0.01"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Valid from (optional)"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
            <Input
              label="Valid until (optional)"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          {affiliateCode && (
            <div>
              <label className="text-sm font-medium block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AffiliateCodeStatus)}
                className={FIELD_CLASS}
              >
                {AFFILIATE_CODE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {affiliateCode ? "Save changes" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
