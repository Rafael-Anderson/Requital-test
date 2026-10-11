import type { ListImportReport } from "@/components/ListImportModal";
import type { CollectionImportReport, CustomerImportReport } from "@/lib/types";

// Maps the collections and customers import reports onto the shared modal's
// row shape. Kept apart from the component so it can be tested on its own.

export function collectionReportToList(
  r: CollectionImportReport,
): ListImportReport {
  return {
    summary: `${r.totals.create} to create, ${r.totals.update} to update, ${r.totals.skip} unchanged, ${r.totals.error} with errors.`,
    warnings: [
      ...r.warnings,
      ...(r.unsupportedColumns.length > 0
        ? [
            `These columns have data but are not imported: ${r.unsupportedColumns.join(", ")}.`,
          ]
        : []),
    ],
    truncated: r.truncated,
    writable: r.totals.create + r.totals.update,
    rows: r.rows.map((row) => ({
      rowNumber: row.rowNumber,
      title: row.name,
      subtitle:
        row.depth !== null && row.depth > 0 ? `level ${row.depth + 1}` : null,
      action: row.action,
      reason: row.reason,
      details: row.changes.map(
        (c) => `${c.field}: ${c.from ?? "empty"} to ${c.to ?? "empty"}`,
      ),
      warnings: row.warnings,
      errors: row.errors,
    })),
  };
}

export function customerReportToList(
  r: CustomerImportReport,
): ListImportReport {
  return {
    summary: `${r.totals.create} to create, ${r.totals.update} to update, ${r.totals.skip} unchanged, ${r.totals.conflict} conflicts, ${r.totals.error} with errors.`,
    note: r.note,
    warnings: r.warnings,
    truncated: r.truncated,
    writable: r.totals.create + r.totals.update,
    rows: r.rows.map((row) => ({
      rowNumber: row.rowNumber,
      title: row.name,
      subtitle: row.phoneMasked,
      action: row.action,
      reason: row.reason,
      details: row.changes.map((c) => `Adds ${c.toLowerCase()}`),
      warnings: row.warnings,
      errors: row.errors,
    })),
  };
}
