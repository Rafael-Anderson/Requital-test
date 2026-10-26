"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listCampaigns } from "@/lib/api";
import type { Campaign } from "@/lib/types";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import CampaignStatusBadge from "@/components/CampaignStatusBadge";
import CampaignReadiness from "@/components/CampaignReadiness";

// Marketing > Campaigns. Admin only in the UI; every endpoint is independently
// admin-gated server-side. A request that fails ends in LoadFailed, never a
// permanent skeleton.
export default function CampaignsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState(false);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listCampaigns()
      .then((rows) => {
        if (mine !== latest.current) return;
        setCampaigns(rows);
        setError(false);
      })
      // A 403 means the feature is off for this shop; the readiness card says so.
      .catch(() => mine === latest.current && setError(true));
  }, []);

  useEffect(() => {
    if (user?.role === "admin") refresh();
  }, [user, refresh]);

  if (user && user.role !== "admin") return null;

  return (
    <PageShell>
      <BackButton href="/" />
      <div className="flex items-center justify-between flex-wrap gap-2 mb-[18px]">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Campaigns</h1>
        {enabled && (
          <Link href="/marketing/campaigns/new">
            <Button size="sm">
              <Plus className="size-3.5 inline -mt-0.5 me-1" />
              New campaign
            </Button>
          </Link>
        )}
      </div>
      <CampaignReadiness onLoaded={(s) => setEnabled(s.enabled)} />
      {enabled && (
        <Table stickyFirst>
          <THead>
            <tr>
              <TH>Campaign</TH>
              <TH>Status</TH>
              <TH>Audience</TH>
              <TH>Sent</TH>
              <TH>Skipped</TH>
              <TH>Failed</TH>
              <TH>Created</TH>
            </tr>
          </THead>
          <TBody>
            {campaigns === null ? (
              <tr>
                <td colSpan={7}>{error ? <LoadFailed what="campaigns" onRetry={refresh} /> : <TableSkeleton rows={6} cols={7} />}</td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No campaigns yet" description="Write a campaign and send it to customers who agreed to marketing emails." />
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <TR key={c.id}>
                  <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">
                    <Link href={`/marketing/campaigns/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TD>
                  <TD>
                    <CampaignStatusBadge status={c.status} />
                  </TD>
                  <TD className="text-[13.5px]">{c.audienceCount ?? "-"}</TD>
                  <TD className="text-[13.5px]">{c.counts.sent}</TD>
                  <TD className="text-[13.5px]">{c.counts.skipped}</TD>
                  <TD className="text-[13.5px]">{c.counts.failed}</TD>
                  <TD className="text-xs text-text-faint">{new Date(c.createdAt).toLocaleDateString()}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      )}
    </PageShell>
  );
}
