"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, ShieldOff, Trash2 } from "lucide-react";
import {
  deleteBranchRole,
  deleteStaffUser,
  listBranchRoleAssignments,
  listBranchRoles,
  listOutlets,
  listShopUsers,
  resetUserTwoFactor,
  unassignBranchRole,
} from "@/lib/api";
import type { AuthUser, BranchRole, BranchRoleAssignment, Outlet } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardRowMenu } from "@/components/ui/CardList";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BranchUserFormModal from "@/components/BranchUserFormModal";
import EditStaffUserFormModal from "@/components/EditStaffUserFormModal";
import BranchRoleFormModal from "@/components/BranchRoleFormModal";
import AssignBranchRoleModal from "@/components/AssignBranchRoleModal";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";

export default function SettingsUsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();

  // For a colleague who lost their device and recovery codes. Never offered for
  // yourself (the API refuses it; use Turn off on the Security page).
  async function handleResetTwoFactor(u: AuthUser) {
    if (!window.confirm(`Reset two-factor for ${u.name}? They will be signed out everywhere and sign in with their password until they set it up again.`)) return;
    try {
      await resetUserTwoFactor(u.id);
      toast(`Two-factor reset for ${u.name}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reset two-factor", "error");
    }
  }
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

  // Every section loads on its own chain: one failed or slow request must not
  // hold another section on its skeleton. Each ends in an error with Try
  // again; a `latest` counter per chain drops a superseded response.
  const [usersError, setUsersError] = useState<string | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const latestUsers = useRef(0);
  const latestOutlets = useRef(0);
  const latestRoles = useRef(0);
  const latestAssignments = useRef(0);

  const refreshUsers = useCallback(() => {
    const mine = ++latestUsers.current;
    listShopUsers()
      .then((list) => {
        if (mine !== latestUsers.current) return;
        setUsers(list);
        setUsersError(null);
      })
      .catch((err) => {
        if (mine !== latestUsers.current) return;
        setUsersError(err instanceof Error ? err.message : "Failed to load staff");
      });
  }, []);

  const refreshOutlets = useCallback(() => {
    const mine = ++latestOutlets.current;
    listOutlets()
      .then((list) => {
        if (mine === latestOutlets.current) setOutlets(list);
      })
      .catch(() => {
        /* the add and assign buttons just stay disabled */
      });
  }, []);

  const refresh = useCallback(() => {
    refreshUsers();
    refreshOutlets();
  }, [refreshUsers, refreshOutlets]);

  const refreshBranchRoles = useCallback(() => {
    const mine = ++latestRoles.current;
    listBranchRoles()
      .then((list) => {
        if (mine !== latestRoles.current) return;
        setBranchRoles(list);
        setRolesError(null);
      })
      .catch((err) => {
        if (mine !== latestRoles.current) return;
        setRolesError(err instanceof Error ? err.message : "Failed to load branch roles");
      });
  }, []);

  const refreshAssignments = useCallback(() => {
    const mine = ++latestAssignments.current;
    listBranchRoleAssignments()
      .then((list) => {
        if (mine !== latestAssignments.current) return;
        setAssignments(list);
        setAssignmentsError(null);
      })
      .catch((err) => {
        if (mine !== latestAssignments.current) return;
        setAssignmentsError(err instanceof Error ? err.message : "Failed to load assignments");
      });
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
            <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Branch accounts</h2>
            <Button
              variant="primary"
              onClick={() => setAddingUser(true)}
              disabled={!outlets || outlets.length === 0}
            >
              <Plus className="size-4 inline -mt-0.5 me-1" />
              New branch account
            </Button>
          </div>

          {users !== null && users.length > 0 && (
            <CardList>
              {users.map((u) => (
                <CardListItem
                  key={u.id}
                  onOpen={() => setEditingUser(u)}
                  openLabel={`Edit ${u.name}`}
                  actions={
                    <CardRowMenu
                      label={`More actions for ${u.name}`}
                      items={[
                        { label: "Edit", icon: <Pencil className="size-3.5" />, onClick: () => setEditingUser(u) },
                        ...(u.id !== me?.id
                          ? [{ label: "Reset two-factor", icon: <ShieldOff className="size-3.5" />, onClick: () => handleResetTwoFactor(u) }]
                          : []),
                        { label: "Delete", icon: <Trash2 className="size-3.5" />, onClick: () => handleDeleteUser(u), danger: true },
                      ]}
                    />
                  }
                >
                  <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{u.name}</div>
                  <div className="truncate text-xs text-text-muted">{u.email}</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    <span className="capitalize">{u.role}</span> · {u.outlet?.name ?? "All branches"}
                  </div>
                </CardListItem>
              ))}
            </CardList>
          )}

          <Table className={users !== null && users.length > 0 ? "hidden md:block" : ""}>
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
                    {usersError ? <LoadFailed what="staff accounts" onRetry={refreshUsers} /> : <TableSkeleton rows={2} cols={5} />}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <TR key={u.id}>
                    <TD>{u.name}</TD>
                    <TD className="text-text-muted">{u.email}</TD>
                    <TD className="capitalize text-text-muted">{u.role}</TD>
                    <TD className="text-text-muted">{u.outlet?.name ?? "All branches"}</TD>
                    <TD>
                      <div className="flex gap-1 justify-end">
                        <Tooltip label={`Edit ${u.name}`}>
                          <button
                            onClick={() => setEditingUser(u)}
                            className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                            aria-label={`Edit ${u.name}`}
                          >
                            <Pencil className="size-4" />
                          </button>
                        </Tooltip>
                        {u.id !== me?.id && (
                          <Tooltip label={`Reset two-factor for ${u.name}`}>
                            <button
                              onClick={() => handleResetTwoFactor(u)}
                              className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                              aria-label={`Reset two-factor for ${u.name}`}
                            >
                              <ShieldOff className="size-4" />
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip label={`Delete ${u.name}. This cannot be undone.`} align="end">
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                            aria-label={`Delete ${u.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </Tooltip>
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
              <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Branch roles</h2>
              <p className="text-sm text-text-muted">
                Reusable permission bundles you can assign to a staff member at one specific outlet,
                layered on top of, not replacing, their role above.
              </p>
            </div>
            <Button variant="primary" onClick={() => setAddingRole(true)}>
              <Plus className="size-4 inline -mt-0.5 me-1" />
              New branch role
            </Button>
          </div>

          <div className="rounded-2xl border border-border dark:border-white/10 overflow-hidden">
            {branchRoles === null ? (
              rolesError ? <LoadFailed what="branch roles" onRetry={refreshBranchRoles} /> : <TableSkeleton rows={2} cols={2} />
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
                      <span className="text-text-faint ms-2 text-xs">
                        {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Tooltip label={`Edit ${r.name}`}>
                        <button
                          onClick={() => setEditingRole(r)}
                          className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          aria-label={`Edit ${r.name}`}
                        >
                          <Pencil className="size-4" />
                        </button>
                      </Tooltip>
                      <Tooltip label={`Delete ${r.name}. This cannot be undone.`} align="end">
                        <button
                          onClick={() => handleDeleteRole(r)}
                          className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </Tooltip>
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
              <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Branch-role assignments</h2>
              <p className="text-sm text-text-muted">
                Overrides one staff member&apos;s access at one specific outlet. Every other outlet stays
                on their role above, unaffected.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setAssigning(true)}
              disabled={!users || !outlets || !branchRoles || users.length === 0 || outlets.length === 0 || branchRoles.length === 0}
            >
              <Plus className="size-4 inline -mt-0.5 me-1" />
              New assignment
            </Button>
          </div>

          {assignments !== null && assignments.length > 0 && (
            <CardList>
              {assignments.map((a) => (
                <CardListItem
                  key={a.id}
                  openLabel={`${a.user.name} at ${a.outlet.name}`}
                  actions={
                    <CardRowMenu
                      label={`More actions for ${a.user.name} at ${a.outlet.name}`}
                      items={[{ label: "Remove assignment", icon: <Trash2 className="size-3.5" />, onClick: () => handleUnassign(a), danger: true }]}
                    />
                  }
                >
                  <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{a.user.name}</div>
                  <div className="truncate text-xs text-text-muted">{a.user.email}</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {a.branchrole.name} · {a.outlet.name}
                  </div>
                </CardListItem>
              ))}
            </CardList>
          )}

          <Table className={assignments !== null && assignments.length > 0 ? "hidden md:block" : ""}>
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
                    {assignmentsError ? (
                      <LoadFailed what="assignments" onRetry={refreshAssignments} />
                    ) : (
                      <TableSkeleton rows={2} cols={4} />
                    )}
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
                      <span className="text-text-faint ms-2 text-xs">{a.user.email}</span>
                    </TD>
                    <TD className="text-text-muted">{a.outlet.name}</TD>
                    <TD className="text-text-muted">{a.branchrole.name}</TD>
                    <TD>
                      <div className="flex justify-end">
                        <Tooltip
                          label={`Remove ${a.branchrole.name} for ${a.user.name} at ${a.outlet.name}. Their shop-wide role stays unchanged.`}
                          align="end"
                        >
                          <button
                            onClick={() => handleUnassign(a)}
                            className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                            aria-label={`Remove assignment for ${a.user.name} at ${a.outlet.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </Tooltip>
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
