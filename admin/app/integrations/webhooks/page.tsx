import PageShell from "@/components/ui/PageShell";
import WebhookActivityPanel from "@/components/WebhookActivityPanel";

export default function WebhooksIntegrationsPage() {
  return (
    <PageShell variant="form">
      <WebhookActivityPanel />
    </PageShell>
  );
}
