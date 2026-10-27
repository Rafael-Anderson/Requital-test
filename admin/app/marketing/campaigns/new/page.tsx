"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createCampaign } from "@/lib/api";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import CampaignEditor from "@/components/CampaignEditor";
import CampaignReadiness from "@/components/CampaignReadiness";

export default function NewCampaignPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/");
  }, [loading, user, router]);
  if (user && user.role !== "admin") return null;

  return (
    <PageShell variant="form">
      <BackButton href="/marketing/campaigns" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">New campaign</h1>
      <CampaignReadiness />
      <CampaignEditor
        initial={{ name: "", subject: "", bodyHtml: "", segmentId: null }}
        saveLabel="Save draft"
        onSave={async (v) => {
          const c = await createCampaign({ ...v, name: v.name.trim(), subject: v.subject.trim() });
          router.push(`/marketing/campaigns/${c.id}`);
        }}
      />
    </PageShell>
  );
}
