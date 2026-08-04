import Skeleton from "@/components/ui/Skeleton";
import { CardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody } from "@/components/ui/Table";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-40 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-white/10 p-6 mb-6 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Table>
        <THead>
          <tr>
            {Array.from({ length: 5 }).map((_, i) => (
              <th key={i} className="p-3">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </THead>
        <TBody>
          <tr>
            <td colSpan={5} className="p-0">
              <TableSkeleton rows={4} cols={5} />
            </td>
          </tr>
        </TBody>
      </Table>
    </div>
  );
}
