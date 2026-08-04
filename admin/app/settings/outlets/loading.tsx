import Skeleton from "@/components/ui/Skeleton";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody } from "@/components/ui/Table";

// app/settings/layout.tsx keeps BackButton/h1/SettingsTabs mounted — this
// only covers the outlet list table + its create button.
export default function Loading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Table>
        <THead>
          <tr>
            {Array.from({ length: 4 }).map((_, i) => (
              <th key={i} className="p-3">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </THead>
        <TBody>
          <tr>
            <td colSpan={4} className="p-0">
              <TableSkeleton rows={5} cols={4} />
            </td>
          </tr>
        </TBody>
      </Table>
    </div>
  );
}
