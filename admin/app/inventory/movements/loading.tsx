import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showTabs showCreateButton={false} cols={6} rows={10} />;
}
