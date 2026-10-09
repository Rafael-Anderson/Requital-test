import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showCreateButton={false} showSearch cols={3} rows={10} />;
}
