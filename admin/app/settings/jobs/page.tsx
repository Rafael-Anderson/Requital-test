import MovedToIntegrations from "@/components/MovedToIntegrations";

// Failed Jobs left the Settings tab bar for Diagnostics (audit §14.3 P7). The
// old route, and /jobs via next.config.ts, still resolve to this pointer.
export default function FailedJobsMovedPage() {
  return (
    <MovedToIntegrations
      href="/settings/diagnostics"
      message="Failed jobs have moved to Diagnostics, next to webhook activity."
      linkLabel="Go to Diagnostics"
    />
  );
}
