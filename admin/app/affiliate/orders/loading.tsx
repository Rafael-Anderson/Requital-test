import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showBack={false} showCreateButton={false} cols={6} rows={8} />;
}
