"use client";

import { useState } from "react";
import {
  createBrand,
  resolveImageUrl,
  updateBrand,
  uploadBrandImage,
} from "@/lib/api";
import type { Brand } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export default function BrandFormModal({
  brand,
  onClose,
  onSaved,
}: {
  brand: Brand | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(brand?.name ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolveImageUrl(brand?.logoUrl),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      let logoUrl: string | undefined;
      if (imageFile) {
        const uploaded = await uploadBrandImage(imageFile);
        logoUrl = uploaded.url;
      }
      if (brand) {
        await updateBrand(brand.id, {
          name,
          ...(logoUrl !== undefined && { logoUrl }),
        });
        toast(`"${name}" updated`);
      } else {
        await createBrand({ name, logoUrl });
        toast(`"${name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save brand", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={brand ? `Edit "${brand.name}"` : "New brand"}
    >
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5">
            <Input
              label="Brand name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <ImageDropzone
              label="Logo (optional)"
              preview={imagePreview}
              onFileSelected={handleFileSelected}
            />
          </div>

          <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              loading={saving}
            >
              {brand ? "Save changes" : "Create brand"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
