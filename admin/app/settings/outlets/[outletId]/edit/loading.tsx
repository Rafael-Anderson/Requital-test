import Skeleton from "@/components/ui/Skeleton";
import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

// Mirrors the outlet sidebar-tabs layout (OutletEditSidebar + one active
// tab's fields) rather than the settings Card-grid shape used elsewhere.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-8 w-64 mb-6" />
      <div className="flex gap-8 flex-col sm:flex-row">
        <div className="w-full sm:w-48 shrink-0 space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <SettingsCardsSkeleton cards={2} fieldsPerCard={3} />
        </div>
      </div>
    </div>
  );
}
