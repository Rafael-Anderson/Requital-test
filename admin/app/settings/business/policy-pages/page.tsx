"use client";

import { useEffect, useState } from "react";
import { getPolicyPages, updatePolicyPage } from "@/lib/api";
import { POLICY_PAGE_TYPES, POLICY_PAGE_LABELS, type PolicyPage, type PolicyPageType } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import RichTextEditor from "@/components/ui/RichTextEditor";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

export default function PolicyPagesSettingsPage() {
  const toast = useToast();
  const [pages, setPages] = useState<PolicyPage[] | null>(null);
  const [selected, setSelected] = useState<PolicyPageType>("TERMS");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPolicyPages().then((rows) => {
      setPages(rows);
      setDraft(rows.find((p) => p.type === selected)?.content ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectType(type: PolicyPageType) {
    setSelected(type);
    setDraft(pages?.find((p) => p.type === type)?.content ?? "");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updatePolicyPage(selected, draft);
      setPages((prev) =>
        (prev ?? []).map((p) => (p.type === selected ? { type: p.type, content: updated.content, updatedAt: updated.updatedAt } : p)),
      );
      toast(`${POLICY_PAGE_LABELS[selected]} saved`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save policy page", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!pages) return <CardSkeleton />;

  return (
    <PageShell variant="wide">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        <Card className="p-2">
          <nav className="space-y-1">
            {POLICY_PAGE_TYPES.map((type) => {
              const written = !!pages.find((p) => p.type === type)?.content;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectType(type)}
                  className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left cursor-pointer transition-colors ${
                    selected === type
                      ? "bg-accent/10 text-accent-text dark:text-accent font-medium"
                      : "hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  <span>{POLICY_PAGE_LABELS[type]}</span>
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${written ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    title={written ? "Published" : "Not written yet"}
                  />
                </button>
              );
            })}
          </nav>
        </Card>

        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">{POLICY_PAGE_LABELS[selected]}</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Publicly viewable on your storefront once saved, and linked from the footer&apos;s Useful Links column.
              Left blank, the footer simply won&apos;t link to it — no broken or empty page.
            </p>
          </div>
          <RichTextEditor label="Content" value={draft} onChange={setDraft} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
