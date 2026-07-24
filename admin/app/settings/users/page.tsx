"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { listOutlets, listShopUsers } from "@/lib/api";
import type { AuthUser, Outlet } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import BranchUserFormModal from "@/components/BranchUserFormModal";

export default function SettingsUsersPage() {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [addingUser, setAddingUser] = useState(false);

  const refresh = useCallback(async () => {
    const [outletList, userList] = await Promise.all([listOutlets(), listShopUsers()]);
    setOutlets(outletList);
    setUsers(userList);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Branch accounts</h2>
        <Button
          variant="primary"
          onClick={() => setAddingUser(true)}
          disabled={!outlets || outlets.length === 0}
        >
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New branch account
        </Button>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Role</TH>
            <TH>Outlet</TH>
          </tr>
        </THead>
        <TBody>
          {users === null ? (
            <tr>
              <td colSpan={4}>
                <TableSkeleton rows={2} cols={4} />
              </td>
            </tr>
          ) : (
            users.map((u) => (
              <TR key={u.id}>
                <TD>{u.name}</TD>
                <TD className="text-zinc-500">{u.email}</TD>
                <TD className="capitalize text-zinc-500">{u.role}</TD>
                <TD className="text-zinc-500">{u.outlet?.name ?? "All branches"}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {addingUser && outlets && (
        <BranchUserFormModal outlets={outlets} onClose={() => setAddingUser(false)} onSaved={refresh} />
      )}
    </div>
  );
}
