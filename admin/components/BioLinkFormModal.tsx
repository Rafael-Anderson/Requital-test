"use client";

import { useState } from "react";
import { createBioLink, updateBioLink, type BioLinkInput } from "@/lib/api";
import {
  BIO_LINK_SOCIAL_PLATFORMS,
  BIO_LINK_SOCIAL_PLATFORM_LABELS,
  BIO_LINK_TYPES,
  BIO_LINK_TYPE_LABELS,
  type BioLink,
  type BioLinkSocialPlatform,
  type BioLinkType,
  type Collection,
  type Template,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

// Product/collection/template pickers use the shared Combobox
// (components/ui/Combobox.tsx) rather than a plain <select> — searchable,
// so a long catalog stays usable.
export default function BioLinkFormModal({
  bioLink,
  products,
  collections,
  templates,
  onClose,
  onSaved,
}: {
  bioLink: BioLink | null;
  products: Product[];
  collections: Collection[];
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<BioLinkType>(bioLink?.type ?? "EXTERNAL_URL");
  const [label, setLabel] = useState(bioLink?.label ?? "");
  const [url, setUrl] = useState(bioLink?.url ?? "");
  const [productId, setProductId] = useState(bioLink?.productId != null ? String(bioLink.productId) : "");
  const [collectionId, setCollectionId] = useState(bioLink?.collectionId != null ? String(bioLink.collectionId) : "");
  const [templateId, setTemplateId] = useState(
    bioLink?.templateId != null ? String(bioLink.templateId) : "",
  );
  const [socialPlatform, setSocialPlatform] = useState<BioLinkSocialPlatform>(
    bioLink?.socialPlatform ?? "instagram",
  );
  const [active, setActive] = useState(bioLink?.active ?? true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function targetValid(): boolean {
    if (type === "EXTERNAL_URL") return !!url.trim();
    if (type === "PRODUCT") return productId !== "";
    if (type === "COLLECTION") return collectionId !== "";
    if (type === "TEMPLATE") return templateId !== "";
    return true; // SOCIAL_ICON always has a platform selected (dropdown default)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (type !== "SOCIAL_ICON" && !label.trim()) return;
    if (!targetValid()) return;

    setSaving(true);
    try {
      const payload: BioLinkInput = {
        type,
        label: label.trim() || undefined,
        ...(type === "EXTERNAL_URL" && { url: url.trim() }),
        ...(type === "PRODUCT" && { productId: Number(productId) }),
        ...(type === "COLLECTION" && { collectionId: Number(collectionId) }),
        ...(type === "TEMPLATE" && { templateId: Number(templateId) }),
        ...(type === "SOCIAL_ICON" && { socialPlatform }),
      };
      if (bioLink) {
        await updateBioLink(bioLink.id, { ...payload, active });
        toast(`"${label || BIO_LINK_TYPE_LABELS[type]}" updated`);
      } else {
        await createBioLink(payload);
        toast(`"${label || BIO_LINK_TYPE_LABELS[type]}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save link", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={bioLink ? "Edit link" : "Add link"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          <div>
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value as BioLinkType)}>
              {BIO_LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BIO_LINK_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label={type === "SOCIAL_ICON" ? "Label (optional)" : "Label"}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={type === "SOCIAL_ICON" ? BIO_LINK_SOCIAL_PLATFORM_LABELS[socialPlatform] : undefined}
            required={type !== "SOCIAL_ICON"}
          />

          {type === "EXTERNAL_URL" && (
            <Input label="URL" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} required />
          )}

          {type === "PRODUCT" && (
            <Combobox
              label="Product"
              value={productId}
              onChange={setProductId}
              placeholder="Select a product…"
              options={products.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          )}

          {type === "COLLECTION" && (
            <Combobox
              label="Collection"
              value={collectionId}
              onChange={setCollectionId}
              placeholder="Select a collection…"
              options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          )}

          {type === "TEMPLATE" && (
            <Combobox
              label="Template"
              value={templateId}
              onChange={setTemplateId}
              placeholder="Select a template…"
              options={templates.map((c) => ({ value: String(c.id), label: c.title }))}
            />
          )}

          {type === "SOCIAL_ICON" && (
            <div>
              <Select
                label="Platform"
                value={socialPlatform}
                onChange={(e) => setSocialPlatform(e.target.value as BioLinkSocialPlatform)}
              >
                {BIO_LINK_SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {BIO_LINK_SOCIAL_PLATFORM_LABELS[p]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-zinc-400 mt-1.5">
                Uses the URL already set for this platform on Online Presence (or your WhatsApp number for
                WhatsApp), nothing more to enter here. The icon won&apos;t appear on your bio page until that&apos;s
                configured.
              </p>
            </div>
          )}

          {bioLink && (
            <div className="flex items-center gap-2">
              <Toggle checked={active} onChange={setActive} />
              <span className="text-sm">Active</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {bioLink ? "Save changes" : "Add link"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
