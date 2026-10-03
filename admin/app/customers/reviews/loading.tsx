import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showCreateButton={false} cols={3} rows={6} />;
}
