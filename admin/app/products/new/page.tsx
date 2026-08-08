"use client";

import BackButton from "@/components/ui/BackButton";
import ProductForm from "@/components/ProductForm";
import PageShell from "@/components/ui/PageShell";

export default function NewProductPage() {
  return (
    <PageShell>
      <BackButton href="/products" />
      <h1 className="text-2xl font-semibold mb-4">New product</h1>
      <ProductForm />
    </PageShell>
  );
}
