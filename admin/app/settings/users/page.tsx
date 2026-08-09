"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteBranchRole,
  deleteStaffUser,
  listBranchRoleAssignments,
  listBranchRoles,
  listOutlets,
  listShopUsers,
  unassignBranchRole,
} from "@/lib/api";
import type { AuthUser, BranchRole, BranchRoleAssignment, Outlet } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BranchUserFormModal from "@/components/BranchUserFormModal";
import EditStaffUserFormModal from "@/components/EditStaffUserFormModal";
import BranchRoleFormModal from "@/components/BranchRoleFormModal";
import AssignBranchRoleModal from "@/components/AssignBranchRoleModal";
import PageShell from "@/components/ui/PageShell";
import { useUndoableDelete } from "@/lib/useUndoableDelete";

export default function SettingsUsersPage() {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const deleteUserWithUndo = useUndoableDelete();

  const [branchRoles, setBranchRoles] = useState<BranchRole[] | null>(null);
  const [addingRole, setAddingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<BranchRole | null>(null);
  const deleteRoleWithUndo = useUndoableDelete();

  const [assignments, setAssignments] = useState<BranchRoleAssignment[] | null>(null);
  const [assigning, setAssigning] = useState(false);
  const deleteAssignmentWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    const [outletList, userList] = await Promise.all([listOutlets(), listShopUsers()]);
    setOutlets(outletList);
    setUsers(userList);
  }, []);

  const refreshBranchRoles = useCallback(async () => {
    setBranchRoles(await listBranchRoles());
  }, []);

  const refreshAssignments = useCallback(async () => {
    setAssignments(await listBranchRoleAssignments());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshBranchRoles();
  }, [refreshBranchRoles]);

  useEffect(() => {
    refreshAssignments();
  }, [refreshAssignments]);

  function handleDeleteUser(user: AuthUser) {
    deleteUserWithUndo({
      id: user.id,
      label: `"${user.name}"`,
      onRemoveLocally: () => setUsers((prev) => (prev ? prev.filter((u) => u.id !== user.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteStaffUser(user.id),
    });
  }

  function handleDeleteRole(role: BranchRole) {
    deleteRoleWithUndo({
      id: role.id,
      label: `"${role.name}"`,
      onRemoveLocally: () => setBranchRoles((prev) => (prev ? prev.filter((r) => r.id !== role.id) : prev)),
      onRestoreLocally: refreshBranchRoles,
      commit: () => deleteBranchRole(role.id),
    });
  }

  function handleUnassign(assignment: BranchRoleAssignment) {
    deleteAssignmentWithUndo({
      id: assignment.id,
      label: `${assignment.user.name} at ${assignment.outlet.name}`,
      onRemoveLocally: () =>
        setAssignments((prev) => (prev ? prev.filter((a) => a.id !== assignment.id) : prev)),
      onRestoreLocally: refreshAssignments,
      commit: () => unassignBranchRole(assignment.userId, assignment.outletId),
    });
  }

  return (
    <PageShell>
      <div className="space-y-8">
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
                <TH></TH>
              </tr>
            </THead>
            <TBody>
              {users === null ? (
                <tr>
                  <td colSpan={5}>
                    <TableSkeleton rows={2} cols={5} />
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <TR key={u.id}>
                    <TD>{u.name}</TD>
                    <TD className="text-zinc-500">{u.email}</TD>
                    <TD className="capitalize text-zinc-500">{u.role}</TD>
                    <TD className="text-zinc-500">{u.outlet?.name ?? "All branches"}</TD>
                    <TD>
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          aria-label={`Edit ${u.name}`}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                          aria-label={`Delete ${u.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Branch roles</h2>
              <p className="text-sm text-zinc-500">
                Reusable permission bundles you can assign to a staff member at one specific outlet,
                layered on top of, not replacing, their role above.
              </p>
            </div>
            <Button variant="primary" onClick={() => setAddingRole(true)}>
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              New branch role
            </Button>
          </div>

          <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
            {branchRoles === null ? (
              <TableSkeleton rows={2} cols={2} />
            ) : branchRoles.length === 0 ? (
              <EmptyState
                title="No branch roles yet"
                description="Create a bundle like &quot;Branch Viewer&quot; to assign a staff member restricted access at a specific outlet."
              />
            ) : (
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {branchRoles.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <div>
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="text-zinc-400 ml-2 text-xs">
                        {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingRole(r)}
                        className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Edit ${r.name}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteRole(r)}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                        aria-label={`Delete ${r.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Branch-role assignments</h2>
              <p className="text-sm text-zinc-500">
                Overrides one staff member&apos;s access at one specific outlet. Every other outlet stays
                on their role above, unaffected.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setAssigning(true)}
              disabled={!users || !outlets || !branchRoles || users.length === 0 || outlets.length === 0 || branchRoles.length === 0}
            >
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              New assignment
            </Button>
          </div>

          <Table>
            <THead>
              <tr>
                <TH>Staff member</TH>
                <TH>Outlet</TH>
                <TH>Branch role</TH>
                <TH></TH>
              </tr>
            </THead>
            <TBody>
              {assignments === null ? (
                <tr>
                  <td colSpan={4}>
                    <TableSkeleton rows={2} cols={4} />
                  </td>
                </tr>
              ) : assignments.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="No assignments yet"
                      description="Assign a branch role to override a staff member's access at one specific outlet."
                    />
                  </td>
                </tr>
              ) : (
                assignments.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      {a.user.name}
                      <span className="text-zinc-400 ml-2 text-xs">{a.user.email}</span>
                    </TD>
                    <TD className="text-zinc-500">{a.outlet.name}</TD>
                    <TD className="text-zinc-500">{a.branchrole.name}</TD>
                    <TD>
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleUnassign(a)}
                          className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                          aria-label={`Remove assignment for ${a.user.name} at ${a.outlet.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </div>
      </div>

      {addingUser && outlets && (
        <BranchUserFormModal outlets={outlets} onClose={() => setAddingUser(false)} onSaved={refresh} />
      )}

      {editingUser && outlets && (
        <EditStaffUserFormModal
          user={editingUser}
          outlets={outlets}
          onClose={() => setEditingUser(null)}
          onSaved={refresh}
        />
      )}

      {(addingRole || editingRole) && (
        <BranchRoleFormModal
          role={editingRole}
          onClose={() => {
            setAddingRole(false);
            setEditingRole(null);
          }}
          onSaved={refreshBranchRoles}
        />
      )}

      {assigning && users && outlets && branchRoles && (
        <AssignBranchRoleModal
          users={users}
          outlets={outlets}
          branchRoles={branchRoles}
          onClose={() => setAssigning(false)}
          onSaved={refreshAssignments}
        />
      )}
    </PageShell>
  );
}
