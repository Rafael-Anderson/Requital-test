import { SettingsCardsSkeleton } from "@/components/ui/Skeleton";

// Layout (app/settings/business/layout.tsx) keeps the sub-nav mounted —
// this only needs to cover the content area that actually swaps.
export default function Loading() {
  return <SettingsCardsSkeleton cards={3} fieldsPerCard={3} />;
}
