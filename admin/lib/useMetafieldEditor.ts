"use client";

import { useCallback, useEffect, useState } from "react";
import { getMetafields, listMetafieldDefinitions, setMetafields } from "@/lib/api";
import {
  changedValues,
  draftFromValue,
  type MetafieldDraft,
} from "@/lib/metafields";
import type { MetafieldDefinition, MetafieldOwnerType } from "@/lib/types";

// Loads the custom fields for one owner type (and, when the record already
// exists, its values), holds the merchant's edits, and saves only the changes.
// `ownerId` null means the record is being created: definitions only, values are
// saved once the record has an id (save(newId)).
export function useMetafieldEditor(
  ownerType: MetafieldOwnerType,
  ownerId: number | null,
) {
  const [defs, setDefs] = useState<MetafieldDefinition[]>([]);
  const [initial, setInitial] = useState<Record<number, MetafieldDraft>>({});
  const [drafts, setDrafts] = useState<Record<number, MetafieldDraft>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load =
      ownerId !== null
        ? getMetafields(ownerType, ownerId)
        : listMetafieldDefinitions(ownerType).then((list) =>
            list.map((d) => ({ ...d, value: null as unknown })),
          );
    load
      .then((entries) => {
        if (cancelled) return;
        const next: Record<number, MetafieldDraft> = {};
        for (const e of entries) next[e.id] = draftFromValue(e, e.value);
        setDefs(
          entries.map((e) => {
            const { value, ...d } = e;
            void value;
            return d;
          }),
        );
        setInitial(next);
        setDrafts(next);
      })
      // A role that may not read these fields just sees none.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerId]);

  const setDraft = useCallback((id: number, draft: MetafieldDraft) => {
    setDrafts((d) => ({ ...d, [id]: draft }));
  }, []);

  // Returns an error message when a draft cannot be converted, so the caller can
  // stop before saving the record itself.
  const validate = useCallback((): string | null => {
    const r = changedValues(defs, initial, drafts);
    return r.ok ? null : r.error;
  }, [defs, initial, drafts]);

  const save = useCallback(
    async (idOverride?: number) => {
      const id = idOverride ?? ownerId;
      const r = changedValues(defs, initial, drafts);
      if (!r.ok) throw new Error(r.error);
      if (id === null || r.values.length === 0) return;
      await setMetafields(ownerType, id, r.values);
    },
    [defs, initial, drafts, ownerType, ownerId],
  );

  return { defs, drafts, loading, setDraft, validate, save };
}

export type MetafieldEditor = ReturnType<typeof useMetafieldEditor>;
