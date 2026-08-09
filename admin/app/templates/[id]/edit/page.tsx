"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getTemplate } from "@/lib/api";
import type { Template } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Skeleton from "@/components/ui/Skeleton";
import TemplateForm from "@/components/TemplateForm";
import PageShell from "@/components/ui/PageShell";

export default function EditTemplatePage() {
  const params = useParams<{ id: string }>();
  const templateId = Number(params.id);

  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTemplate(templateId)
      .then(setTemplate)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load template"));
  }, [templateId]);

  if (error) {
    return (
      <PageShell>
        <BackButton href="/templates" />
        <p className="text-red-600 text-sm">{error}</p>
      </PageShell>
    );
  }
  if (!template) {
    return (
      <PageShell>
        <BackButton href="/templates" />
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
