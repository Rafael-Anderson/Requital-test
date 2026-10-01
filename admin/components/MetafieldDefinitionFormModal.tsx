"use client";

import { useState } from "react";
import { createMetafieldDefinition, updateMetafieldDefinition } from "@/lib/api";
import {
  METAFIELD_OWNER_LABELS,
  METAFIELD_OWNER_TYPES,
  METAFIELD_TYPES,
  METAFIELD_TYPE_LABELS,
  type MetafieldDefinition,
  type MetafieldOwnerType,
  type MetafieldType,
  type MetafieldValidation,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

// Customer and order fields hold personal data, so the backend refuses to show
// them on the storefront; the toggle is simply not offered for them.
const NEVER_PUBLIC: MetafieldOwnerType[] = ["customer", "order"];

function slugKey(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);
}

function numOrUndef(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// Builds the validation object for the chosen type from the form's raw inputs.
function buildValidation(
  type: MetafieldType,
  f: { options: string; minLength: string; maxLength: string; min: string; max: string; integer: boolean },
): MetafieldValidation | undefined {
  switch (type) {
    case "text":
    case "multiline": {
      const v: MetafieldValidation = {};
      const minLength = numOrUndef(f.minLength);
      const maxLength = numOrUndef(f.maxLength);
      if (minLength !== undefined) v.minLength = minLength;
      if (maxLength !== undefined) v.maxLength = maxLength;
      return v;
    }
    case "number": {
      const v: MetafieldValidation = {};
      const min = numOrUndef(f.min);
      const max = numOrUndef(f.max);
      if (min !== undefined) v.min = min;
      if (max !== undefined) v.max = max;
      if (f.integer) v.integer = true;
      return v;
    }
    case "single_select":
    case "multi_select":
      return {
        options: f.options
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean),
      };
    default:
      return undefined;
  }
}

export default function MetafieldDefinitionFormModal({
  definition,
  defaultOwnerType,
  onClose,
  onSaved,
}: {
  definition: MetafieldDefinition | null;
  defaultOwnerType: MetafieldOwnerType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const v = definition?.validation;
  const [ownerType, setOwnerType] = useState<MetafieldOwnerType>(
    definition?.ownerType ?? defaultOwnerType,
  );
  const [name, setName] = useState(definition?.name ?? "");
  const [namespace, setNamespace] = useState(definition?.namespace ?? "custom");
  const [key, setKey] = useState(definition?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(!!definition);
  const [type, setType] = useState<MetafieldType>(definition?.type ?? "text");
  const [options, setOptions] = useState((v?.options ?? []).join("\n"));
  const [minLength, setMinLength] = useState(v?.minLength != null ? String(v.minLength) : "");
  const [maxLength, setMaxLength] = useState(v?.maxLength != null ? String(v.maxLength) : "");
  const [min, setMin] = useState(v?.min != null ? String(v.min) : "");
  const [max, setMax] = useState(v?.max != null ? String(v.max) : "");
  const [integer, setInteger] = useState(v?.integer ?? false);
  const [visible, setVisible] = useState(definition?.visibleOnStorefront ?? false);
  const [displayOrder, setDisplayOrder] = useState(String(definition?.displayOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const isEdit = definition !== null;
  const canBePublic = !NEVER_PUBLIC.includes(ownerType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const validation = buildValidation(type, { options, minLength, maxLength, min, max, integer });
      const order = Number(displayOrder) || 0;
      if (definition) {
        await updateMetafieldDefinition(definition.id, {
          name,
          displayOrder: order,
          visibleOnStorefront: canBePublic ? visible : false,
          ...(validation !== undefined && { validation }),
        });
        toast(`"${name}" updated`);
      } else {
        await createMetafieldDefinition({
          ownerType,
          namespace,
          key,
          name,
          type,
          displayOrder: order,
          visibleOnStorefront: canBePublic ? visible : false,
          ...(validation !== undefined && { validation }),
        });
        toast(`"${name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save custom field", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={definition ? `Edit "${definition.name}"` : "New custom field"}
    >
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5">
            <Select
              label="Applies to"
              value={ownerType}
              disabled={isEdit}
              onChange={(e) => setOwnerType(e.target.value as MetafieldOwnerType)}
            >
              {METAFIELD_OWNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {METAFIELD_OWNER_LABELS[t]}
                </option>
              ))}
            </Select>

            <Input
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(slugKey(e.target.value));
              }}
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Namespace"
                value={namespace}
                disabled={isEdit}
                onChange={(e) => setNamespace(e.target.value)}
                required
              />
              <Input
                label="Key"
                value={key}
                disabled={isEdit}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                required
              />
            </div>
            <p className="text-[13px] text-text-muted -mt-2">
              Lowercase letters, digits and underscores. The handle{" "}
              <span className="font-mono">
                {namespace || "namespace"}.{key || "key"}
              </span>{" "}
              cannot be changed after the field is created.
            </p>

            <Select
              label="Field type"
              value={type}
              disabled={isEdit}
              onChange={(e) => setType(e.target.value as MetafieldType)}
            >
              {METAFIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {METAFIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>

            {(type === "single_select" || type === "multi_select") && (
              <Textarea
                label="Options (one per line)"
                value={options}
                rows={4}
                onChange={(e) => setOptions(e.target.value)}
              />
            )}

            {(type === "text" || type === "multiline") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Minimum length"
                  type="number"
                  min="0"
                  value={minLength}
                  onChange={(e) => setMinLength(e.target.value)}
                />
                <Input
                  label="Maximum length"
                  type="number"
                  min="1"
                  value={maxLength}
                  onChange={(e) => setMaxLength(e.target.value)}
                />
              </div>
            )}

            {type === "number" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Minimum"
                    type="number"
                    step="any"
                    value={min}
                    onChange={(e) => setMin(e.target.value)}
                  />
                  <Input
                    label="Maximum"
                    type="number"
                    step="any"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2.5">
                  <Toggle checked={integer} onChange={setInteger} />
                  <span className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">
                    Whole numbers only
                  </span>
                </div>
              </>
            )}

            {isEdit && (
              <p className="text-[13px] text-text-muted">
                Changing a rule is refused while a saved value would break it.
                Edit or clear those values first.
              </p>
            )}

            <Input
              label="Display order"
              type="number"
              min="0"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />

            {canBePublic ? (
              <div className="flex items-center gap-2.5">
                <Toggle checked={visible} onChange={setVisible} />
                <span className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">
                  Include in the public storefront data
                </span>
              </div>
            ) : (
              <p className="text-[13px] text-text-muted">
                {METAFIELD_OWNER_LABELS[ownerType]} fields hold personal data
                and are never shown on the storefront.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              {definition ? "Save changes" : "Create field"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
