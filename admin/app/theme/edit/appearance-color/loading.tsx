import { CardSkeleton } from "@/components/ui/Skeleton";

// app/theme/edit/layout.tsx keeps BackButton/h1/ThemeTabs mounted. Mirrors
// this page's own internal `!theme` fallback (3 CardSkeletons in a grid).
export default function Loading() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
