"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, Trash2, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { deleteCustomerSegment, downloadExport, listCustomerSegments, listCustomerTags } from "@/lib/api";
import type { CustomerSegment, CustomerTagWithCount } from "@/lib/types";
import { describeNode, fromPayload } from "@/lib/segment-rules";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import { useToast } from "@/components/ui/Toast";
import CustomersTabs from "@/components/CustomersTabs";
import SegmentBuilderModal from "@/components/customers/SegmentBuilderModal";

// Saved filters over customers. Admin-only in the UI (the customers pages all are);
// the endpoints are independently role-gated server-side.
export default function CustomerSegmentsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [segments, setSegments] = useState<CustomerSegment[] | null>(null);
  const [tags, setTags] = useState<CustomerTagWithCount[]>([]);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<CustomerSegment | null | "new">(null);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    let live = true;
    listCustomerSegments()
      .then((d) => live && setSegments(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [user, tick]);

  // Only used to name tags inside a rule's description and to fill the builder.
  useEffect(() => {
    if (user?.role !== "admin") return;
    let live = true;
    listCustomerTags()
      .then((d) => live && setTags(d))
      .catch(() => live && setTags([]));
    return () => {
      live = false;
    };
  }, [user]);

  if (user && user.role !== "admin") return null;

  const tagName = (id: number) => tags.find((t) => t.id === id)?.name ?? `tag ${id}`;
  const describe = (s: CustomerSegment) => describeNode(fromPayload(s.rules), tagName);
  const reload = () => setTick((t) => t + 1);

  async function handleDelete(s: CustomerSegment) {
    if (!window.confirm(`Delete the segment "${s.name}"? No customers are affected.`)) return;
    try {
      await deleteCustomerSegment(s.id);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete segment", "error");
    }
  }

  async function handleExport(s: CustomerSegment) {
    try {
      await downloadExport("customer-segment", { segmentId: s.id });
      toast("Export started");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to export", "error");
    }
  }

  const actions = (s: CustomerSegment) => (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`View members of ${s.name}`} className="cursor-pointer p-1.5 text-text-faint hover:text-text-primary" onClick={() => router.push(`/customers?segmentId=${s.id}`)}>
        <Users className="size-4" />
      </button>
      <button type="button" aria-label={`Export ${s.name}`} className="cursor-pointer p-1.5 text-text-faint hover:text-text-primary" onClick={() => void handleExport(s)}>
        <Download className="size-4" />
      </button>
      <button type="button" aria-label={`Edit ${s.name}`} className="cursor-pointer p-1.5 text-text-faint hover:text-text-primary" onClick={() => setEditing(s)}>
        <Pencil className="size-4" />
      </button>
      <button type="button" aria-label={`Delete ${s.name}`} className="cursor-pointer p-1.5 text-text-faint hover:text-red-600" onClick={() => void handleDelete(s)}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );

  const placeholder = error && segments === null ? (
    <LoadFailed
      what="segments"
      onRetry={() => {
        setError(false);
        reload();
      }}
    />
  ) : segments !== null && segments.length === 0 ? (
    <EmptyState title="No segments yet" description="A segment is a saved filter, for example customers with 3 or more orders who have not ordered in 90 days." />
  ) : null;

  return (
    <PageShell>
      <BackButton href="/" />
      <h1 className="mb-[18px] text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Customers</h1>
      <CustomersTabs />
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          New segment
        </Button>
      </div>

      {segments === null && !error ? (
        <CardListSkeleton rows={4} />
      ) : placeholder ? (
        <div className="rounded-2xl border border-border bg-surface md:hidden dark:border-white/10 dark:bg-zinc-900">{placeholder}</div>
      ) : (
        <CardList>
          {(segments ?? []).map((s) => (
            <CardListItem key={s.id} onOpen={() => setEditing(s)} openLabel={`Edit ${s.name}`} actions={actions(s)}>
              <div className="truncate text-sm font-semibold">{s.name}</div>
              <div className="text-[13px] text-text-muted">{describe(s)}</div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Rules</TH>
            <TH className="w-40">Actions</TH>
          </tr>
        </THead>
        <TBody>
          {segments === null && !error ? (
            <tr>
              <td colSpan={3}>
                <TableSkeleton rows={4} cols={3} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={3}>{placeholder}</td>
            </tr>
          ) : (
            (segments ?? []).map((s) => (
              <TR key={s.id}>
                <TD className="text-sm font-semibold">{s.name}</TD>
                <TD className="text-[13.5px] text-text-muted">{describe(s)}</TD>
                <TD>{actions(s)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {editing !== null && (
        <SegmentBuilderModal
          segment={editing === "new" ? null : editing}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}
