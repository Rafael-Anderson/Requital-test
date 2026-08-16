// Preview-mode-only element tagging for the theme builder's double-click
// select/drag/edit feature (PreviewInteraction.tsx reads these via
// event delegation — closest('[data-requital-editable="true"]')). Returns
// an empty object outside preview mode so these attributes never reach a
// real shopper's DOM — zero impact on the real storefront, per the task's
// explicit requirement. A plain function (not a wrapper component) so it
// composes with whatever native tag each element already renders as
// (h1/p/a/img/nav/...) without a polymorphic-component layer.
export interface EditableAttrs {
  "data-requital-id"?: string;
  "data-requital-section"?: string;
  "data-requital-type"?: string;
  "data-requital-editable"?: "true";
  "data-requital-reorderable"?: "true";
}

export function editableAttrs(
  previewMode: boolean,
  opts: { id: string; sectionId: string; type: string; reorderable?: boolean },
): EditableAttrs {
  if (!previewMode) return {};
  return {
    "data-requital-id": opts.id,
    "data-requital-section": opts.sectionId,
    "data-requital-type": opts.type,
    "data-requital-editable": "true",
    ...(opts.reorderable ? { "data-requital-reorderable": "true" as const } : {}),
  };
}
