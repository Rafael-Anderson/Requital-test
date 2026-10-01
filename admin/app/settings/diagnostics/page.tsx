"use client";

import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";
import FailedJobsPanel from "@/components/FailedJobsPanel";
import WebhookActivityPanel from "@/components/WebhookActivityPanel";

// Settings > Diagnostics (audit §14.4): "is something broken?" in one place.
// Both halves use the endpoints they always used (GET /webhook-log,
// GET /jobs/failed and its retry/dismiss), so no backend change. Webhook
// activity is also still reachable from Integrations > Incoming Webhooks.
export default function DiagnosticsPage() {
  return (
    <PageShell>
      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50 mb-2">Webhook activity</h2>
          <WebhookActivityPanel />
        </Card>
        <Card>
          <FailedJobsPanel />
        </Card>
      </div>
    </PageShell>
  );
}
