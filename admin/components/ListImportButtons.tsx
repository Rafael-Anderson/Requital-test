"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  confirmCollectionImport,
  confirmCustomerImport,
  previewCollectionImport,
  previewCustomerImport,
} from "@/lib/api";
import {
  collectionReportToList,
  customerReportToList,
} from "@/lib/list-import-adapters";
import Button from "@/components/ui/Button";
import ListImportModal from "@/components/ListImportModal";

// Import entry points for the collections and customers lists. Admin only,
// like the endpoints behind them.

export function CollectionImportButton({
  onImported,
}: {
  onImported: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (user?.role !== "admin") return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="size-4 inline -mt-0.5 me-1" />
        Import
      </Button>
      {open && (
        <ListImportModal
          title="Import collections"
          intro="Upload a CSV or Excel file with a Name column and, optionally, Parent, Slug, Description and Image columns. A parent can be another row in the file."
          existingLabel="Collections that already exist"
          previewFn={async (file, onExisting) =>
            collectionReportToList(
              await previewCollectionImport(file, onExisting),
            )
          }
          confirmFn={async (file, onExisting) => {
            const r = await confirmCollectionImport(file, onExisting);
            return `Imported: ${r.created} created, ${r.updated} updated, ${r.skipped} unchanged`;
          }}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}

export function CustomerImportButton({
  onImported,
}: {
  onImported: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (user?.role !== "admin") return null;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="size-3.5 inline -mt-0.5 me-1" />
        Import
      </Button>
      {open && (
        <ListImportModal
          title="Import customers"
          intro="Upload a CSV or Excel file with Name and Phone columns and, optionally, Email, Address and City. A phone number is matched however it is written, so nobody is added twice. Imported customers are not subscribed to anything and are not contacted."
          existingLabel="Customers who already exist"
          previewFn={async (file, onExisting) =>
            customerReportToList(await previewCustomerImport(file, onExisting))
          }
          confirmFn={async (file, onExisting) => {
            const r = await confirmCustomerImport(file, onExisting);
            return `Imported: ${r.created} created, ${r.updated} updated, ${r.skipped} unchanged`;
          }}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}
