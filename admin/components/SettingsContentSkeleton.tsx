import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

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
