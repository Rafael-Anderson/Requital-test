"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteTemplate, listTemplates } from "@/lib/api";
import { TEMPLATE_TYPE_LABELS, type Template } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import ProductsTabs from "@/components/ProductsTabs";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deleteWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    try {
      setTemplates(await listTemplates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleDelete(template: Template) {
    deleteWithUndo({
      id: template.id,
      label: `"${template.title}"`,
      onRemoveLocally: () => setTemplates((prev) => (prev ? prev.filter((c) => c.id !== template.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteTemplate(template.id),
    });
  }

  return (
    <PageShell>
      <BackButton href="/products" />
      <ProductsTabs />
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Link href="/products/templates/new">
          <Button variant="primary">
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            New template
          </Button>
        </Link>
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        Marketing groupings that cut across collections — &quot;Summer Sale&quot;, &quot;New Arrivals&quot;, and similar.
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Title</TH>
            <TH className="w-48">Type</TH>
            <TH className="w-24">Products</TH>
            <TH className="w-20">Status</TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {templates === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={3} cols={6} />
              </td>
            </tr>
          ) : templates.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  title="No templates yet"
                  description="Group products for marketing campaigns, independent of your collection tree."
                />
              </td>
            </tr>
          ) : (
            templates.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.title}</TD>
                <TD className="text-zinc-500">{TEMPLATE_TYPE_LABELS[c.type]}</TD>
                <TD className="text-zinc-500">{c.productCount}</TD>
                <TD>
                  <span
                    className={`text-xs rounded px-2 py-1 border ${
                      c.isActive
                        ? "border-green-400 text-green-700 dark:text-green-400"
                        : "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400"
                    }`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </TD>
                <TD>
                  <Tooltip label={`Edit ${c.title}`}>
                    <Link
                      href={`/products/templates/${c.id}/edit`}
                      className="inline-flex p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      aria-label={`Edit ${c.title}`}
                    >
                      <Pencil className="size-4" />
                    </Link>
                  </Tooltip>
                </TD>
                <TD>
                  <Tooltip label={`Delete ${c.title}. This cannot be undone.`} align="end">
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      aria-label={`Delete ${c.title}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Tooltip>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
