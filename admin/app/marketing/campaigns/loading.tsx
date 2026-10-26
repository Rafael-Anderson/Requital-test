import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showCreateButton showSearch={false} cols={7} rows={8} />;
}
