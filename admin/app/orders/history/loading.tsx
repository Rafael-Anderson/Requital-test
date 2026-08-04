import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showCreateButton={false} showTabs showSearch cols={6} rows={8} />;
}
