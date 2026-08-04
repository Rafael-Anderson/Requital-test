"use client";

import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import RichTextEditor from "@/components/ui/RichTextEditor";
import ProductMediaGallery from "@/components/ProductMediaGallery";
import type { ProductFormState } from "@/lib/useProductForm";

export default function ProductFormStepBasics({ form }: { form: ProductFormState }) {
  return (
    <>
      <Card className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input label="Title" value={form.name} onChange={(e) => form.setName(e.target.value)} error={form.fieldErrors.name} />
        </div>
        <RichTextEditor label="Description" value={form.description} onChange={form.setDescription} />
      </Card>

      <Card>
        <ProductMediaGallery images={form.images} onChange={form.setImages} />
        {form.fieldErrors.image && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            {form.fieldErrors.image}
          </p>
        )}
      </Card>
    </>
  );
}
