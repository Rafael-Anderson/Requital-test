"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import RichTextEditor from "@/components/ui/RichTextEditor";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { listCustomerSegments } from "@/lib/api";
import type { CustomerSegment } from "@/lib/types";

export interface CampaignDraftValues {
  name: string;
  subject: string;
  bodyHtml: string;
  segmentId: number | null;
}

// The fields of a draft campaign. The body is whatever the editor produces; the
// server sanitises it on save and the saved version is what the preview shows.
export default function CampaignEditor({
  initial,
  saveLabel,
  onSave,
}: {
  initial: CampaignDraftValues;
  saveLabel: string;
  onSave: (values: CampaignDraftValues) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listCustomerSegments()
      .then((s) => live && setSegments(s))
      // Without the list the segment stays as it was; the rest of the form works.
      .catch(() => live && setSegments([]));
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the campaign");
    } finally {
      setSaving(false);
    }
  }

  const valid = values.name.trim() !== "" && values.subject.trim() !== "" && values.bodyHtml.replace(/<[^>]*>/g, "").trim() !== "";

  return (
    <form onSubmit={submit}>
      <Card className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Campaign name" value={values.name} maxLength={120} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
          <Input label="Email subject" value={values.subject} maxLength={200} onChange={(e) => setValues({ ...values, subject: e.target.value })} required />
        </div>
        <Select
          label="Audience"
          value={values.segmentId ?? ""}
          onChange={(e) => setValues({ ...values, segmentId: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Everyone who agreed to marketing emails</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (only those who agreed)
            </option>
          ))}
        </Select>
        <p className="text-xs text-text-faint">
          A segment only narrows the audience. Customers who have not agreed to marketing emails are never included, whatever
          the segment says.
        </p>
        <RichTextEditor label="Email body" value={values.bodyHtml} onChange={(html) => setValues((v) => ({ ...v, bodyHtml: html }))} />
        <p className="text-xs text-text-faint">
          Formatting and links are kept. Images, scripts and other markup are removed when you save. A footer with your shop
          details and an unsubscribe link is added to every email.
        </p>
        {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!valid}>
            {saveLabel}
          </Button>
        </div>
      </Card>
    </form>
  );
}
