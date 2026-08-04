import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListPageSkeleton showCreateButton={false} cols={5} rows={10} />;
}
