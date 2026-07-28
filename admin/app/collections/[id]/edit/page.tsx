"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getCollection } from "@/lib/api";
import type { Collection } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Skeleton from "@/components/ui/Skeleton";
import CollectionForm from "@/components/CollectionForm";
import PageShell from "@/components/ui/PageShell";

export default function EditCollectionPage() {
  const params = useParams<{ id: string }>();
  const collectionId = Number(params.id);

  const [collection, setCollection] = useState<Collection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCollection(collectionId)
      .then(setCollection)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load collection"));
  }, [collectionId]);

  if (error) {
    return (
      <PageShell>
        <BackButton href="/collections" />
        <p className="text-red-600 text-sm">{error}</p>
      </PageShell>
    );
  }
  if (!collection) {
    return (
      <PageShell>
        <BackButton href="/collections" />
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-8 w-40" />
        </div>
      </PageShell>
    );
  }
  return <CollectionForm collection={collection} />;
}
