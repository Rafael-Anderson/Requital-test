"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  cancelCampaign,
  getCampaign,
  getCampaignAudience,
  getCampaignStatus,
  sendCampaign,
  sendCampaignTest,
  updateCampaign,
} from "@/lib/api";
import type { Campaign, CampaignStatusInfo } from "@/lib/types";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import LoadFailed from "@/components/ui/LoadFailed";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";
import CampaignEditor from "@/components/CampaignEditor";
import CampaignReadiness from "@/components/CampaignReadiness";
import CampaignStatusBadge from "@/components/CampaignStatusBadge";

const POLL_MS = 5000;

export default function CampaignDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<CampaignStatusInfo | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [audienceError, setAudienceError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"test" | "send" | "cancel" | "audience" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    getCampaign(id)
      .then((c) => {
        if (mine !== latest.current) return;
        setCampaign(c);
        setFailed(false);
      })
      .catch(() => mine === latest.current && setFailed(true));
  }, [id]);

  useEffect(() => {
    if (user?.role === "admin") refresh();
  }, [user, refresh]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    let live = true;
    getCampaignStatus()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [user]);

  // Progress while a campaign is going out.
  const sending = campaign?.status === "sending";
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [sending, refresh]);

  if (user && user.role !== "admin") return null;

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function checkAudience() {
    setAudienceError(false);
    return run("audience", async () => {
      try {
        setAudience((await getCampaignAudience(id)).count);
      } catch (err) {
        setAudienceError(true);
        throw err;
      }
    });
  }

  const canSend = !!status?.enabled && !!status.sendingDomainVerified;

  return (
    <PageShell variant="form">
      <BackButton href="/marketing/campaigns" />
      {campaign === null ? (
        failed ? (
          <LoadFailed what="this campaign" onRetry={refresh} />
        ) : (
          <p className="text-sm text-text-faint">Loading...</p>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-[18px]">
            <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <CampaignReadiness />

          {campaign.status === "draft" ? (
            <CampaignEditor
              key={campaign.updatedAt}
              initial={{
                name: campaign.name,
                subject: campaign.subject,
                bodyHtml: campaign.bodyHtml ?? "",
                segmentId: campaign.segmentId,
              }}
              saveLabel="Save changes"
              onSave={async (v) => {
                const saved = await updateCampaign(id, { ...v, name: v.name.trim(), subject: v.subject.trim() });
                setCampaign(saved);
                setAudience(null);
                toast(saved.removedTags && saved.removedTags.length > 0 ? `Saved. Removed: ${saved.removedTags.join(", ")}` : "Saved");
              }}
            />
          ) : (
            <Card className="mb-4">
              <p className="text-sm font-semibold text-text-primary dark:text-zinc-100">Subject</p>
              <p className="text-sm text-text-muted mb-3">{campaign.subject}</p>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {(
                  [
                    ["Audience", campaign.audienceCount ?? 0],
                    ["Sent", campaign.counts.sent],
                    ["Skipped", campaign.counts.skipped],
                    ["Failed", campaign.counts.failed],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-text-faint">{k}</dt>
                    <dd className="text-lg font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-text-faint mt-3">
                Skipped means the person withdrew consent, unsubscribed or was suppressed after the audience was set, so they
                were not emailed.
              </p>
              {campaign.failureReason && <InlineErrorMessage className="mt-3">{campaign.failureReason}</InlineErrorMessage>}
            </Card>
          )}

          <Card className="mt-4">
            <p className="text-sm font-semibold text-text-primary dark:text-zinc-100 mb-2">Preview</p>
            {/* The saved body is sanitised by the server, and the frame is sandboxed with no
                permissions, so nothing in it can run or reach this page. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={`<div style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#111;padding:8px">${campaign.bodyHtml ?? ""}</div>`}
              className="w-full h-64 rounded-lg border border-border bg-white"
            />
          </Card>

          {(campaign.status === "draft" || campaign.status === "sending") && (
            <Card className="mt-4 space-y-3">
              {actionError && <InlineErrorMessage>{actionError}</InlineErrorMessage>}
              {campaign.status === "draft" && (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button variant="secondary" size="sm" loading={busy === "audience"} onClick={() => void checkAudience()}>
                      Check audience size
                    </Button>
                    {audience !== null && (
                      <span role="status" className="text-sm">
                        {audience} {audience === 1 ? "person" : "people"} would receive this.
                      </span>
                    )}
                    {audienceError && <span className="text-sm text-red-600">Could not count the audience.</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === "test"}
                      disabled={!canSend}
                      onClick={() =>
                        void run("test", async () => {
                          await sendCampaignTest(id);
                          toast("Test email sent to your address");
                        })
                      }
                    >
                      Send test to me
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canSend}
                      onClick={() => {
                        setConfirming(true);
                        void checkAudience();
                      }}
                    >
                      Send campaign
                    </Button>
                    {!canSend && status && <span className="text-xs text-text-faint">A verified sending domain is needed to send.</span>}
                  </div>
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                loading={busy === "cancel"}
                onClick={() => {
                  if (!window.confirm("Cancel this campaign? Emails not yet sent will not go out.")) return;
                  void run("cancel", async () => {
                    setCampaign(await cancelCampaign(id));
                  });
                }}
              >
                Cancel campaign
              </Button>
            </Card>
          )}

          {confirming && (
            <Modal title="Send this campaign?" size="sm" onClose={() => setConfirming(false)}>
              {(requestClose) => (
                <div className="space-y-4">
                  <p className="text-sm">
                    {audience === null
                      ? "Counting who will receive it..."
                      : `This will email ${audience} ${audience === 1 ? "person" : "people"} who agreed to marketing emails. It cannot be undone once it starts, but you can cancel before every email has gone out.`}
                  </p>
                  {actionError && <InlineErrorMessage>{actionError}</InlineErrorMessage>}
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={requestClose}>
                      Back
                    </Button>
                    <Button
                      loading={busy === "send"}
                      disabled={!audience}
                      onClick={() =>
                        void run("send", async () => {
                          setCampaign(await sendCampaign(id));
                          requestClose();
                          toast("Campaign is sending");
                        })
                      }
                    >
                      Send now
                    </Button>
                  </div>
                </div>
              )}
            </Modal>
          )}
        </>
      )}
    </PageShell>
  );
}
