"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { updateOutlet } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import { mergeBusinessHours } from "@/lib/business-hours";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import BusinessHoursEditor from "@/components/BusinessHoursEditor";
import { useToast } from "@/components/ui/Toast";

export default function OutletBasicInfoTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [name, setName] = useState(outlet.name);
  const [nameAr, setNameAr] = useState(outlet.nameAr ?? "");
  const [email, setEmail] = useState(outlet.email ?? "");
  const [phone, setPhone] = useState(outlet.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(outlet.whatsapp ?? "");
  const [businessHours, setBusinessHours] = useState(mergeBusinessHours(outlet.businessHours));
  const [closedOverride, setClosedOverride] = useState(outlet.closedOverride);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSave() {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await updateOutlet(outlet.id, {
        name,
        nameAr: nameAr || undefined,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        businessHours,
        closedOverride,
      });
      toast("Basic information saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Name in Arabic" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Input label="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

      <div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Hours</p>
        <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
        <div className="mt-2">
          <Checkbox
            label="Force closed (overrides hours regardless of schedule)"
            checked={closedOverride}
            onChange={(e) => setClosedOverride(e.target.checked)}
          />
        </div>
      </div>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
    </div>
  );
}
