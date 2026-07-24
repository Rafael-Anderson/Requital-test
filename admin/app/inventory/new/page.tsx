"use client";

import BackButton from "@/components/ui/BackButton";
import ProductForm from "@/components/ProductForm";

export default function NewProductPage() {
  return (
    <div className="page-transition">
      <BackButton fallbackHref="/inventory" />
      <h1 className="text-2xl font-semibold mb-4">New product</h1>
      <ProductForm />
    </div>
  );
}
