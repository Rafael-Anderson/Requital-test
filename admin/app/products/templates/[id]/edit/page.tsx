"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getTemplate } from "@/lib/api";
import type { Template } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Skeleton from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import TemplateForm from "@/components/TemplateForm";
import PageShell from "@/components/ui/PageShell";

export default function EditTemplatePage() {
  const params = useParams<{ id: string }>();
  const templateId = Number(params.id);

  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Try again bumps `reloadKey`; the load runs in promise callbacks.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    getTemplate(templateId)
      .then((t) => {
        if (live) setTemplate(t);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load template");
      });
    return () => {
      live = false;
    };
  }, [templateId, reloadKey]);

  if (error && !template) {
    return (
      <PageShell>
        <BackButton href="/products/templates" />
        <LoadFailed
          what="the template"
          onRetry={() => {
            setError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      </PageShell>
    );
  }
  if (!template) {
    return (
      <PageShell>
        <BackButton href="/products/templates" />
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-8 w-40" />
        </div>
      </PageShell>
    );
  }
  return <TemplateForm template={template} />;
}
