"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

// "Promotion For" is deliberately free text ("All Products" default, or
// whatever the merchant types) rather than a real product/collection link —
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
    <Modal onClose={onClose} size="sm" title={affiliateCode ? `Edit "${affiliateCode.code}"` : "Add Referral"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          {!affiliateCode && (
            <Select
              label="Affiliate"
              value={affiliateId}
              onChange={(e) => setAffiliateId(e.target.value ? Number(e.target.value) : "")}
              required
            >
              <option value="">Select an affiliate…</option>
              {affiliates?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
          {!affiliateCode && (
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
          )}
          <Input label="Promotion For" value={promotionFor} onChange={(e) => setPromotionFor(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Commission Type"
              value={commissionType}
              onChange={(e) => setCommissionType(e.target.value as CommissionType)}
            >
              {COMMISSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "percentage" ? "Percentage" : "Fixed amount"}
                </option>
              ))}
            </Select>
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
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as AffiliateCodeStatus)}>
              {AFFILIATE_CODE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {affiliateCode ? "Save changes" : "Create"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
