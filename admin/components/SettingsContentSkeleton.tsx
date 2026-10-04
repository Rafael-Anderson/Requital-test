import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";
import Card from "@/components/ui/Card";
import LoadFailed from "@/components/ui/LoadFailed";

// The content column of a Settings page while it fetches on mount (or while the
// session resolves), so the column is never blank. Same shape as the route
// loading.tsx files, with aria-busy so the audit and assistive tech see it.
export default function SettingsContentSkeleton({ cards = 3, fieldsPerCard = 3 }: { cards?: number; fieldsPerCard?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <SettingsCardsSkeleton cards={cards} fieldsPerCard={fieldsPerCard} />
    </div>
  );
}

// What a Settings page shows when its first request failed: say so and offer a
// retry, so a failed load never leaves the skeleton on screen for good.
export function SettingsLoadFailed({ what = "these settings", onRetry }: { what?: string; onRetry: () => void }) {
  return (
    <Card>
      <LoadFailed what={what} onRetry={onRetry} />
    </Card>
  );
}
