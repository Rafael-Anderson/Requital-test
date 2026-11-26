"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import BackButton from "@/components/ui/BackButton";
import DraftOrderBuilder from "@/components/DraftOrderBuilder";

// Orders > Create order. `?customerId=` (from a customer's page) prefills them.
function NewDraftOrder() {
  const params = useSearchParams();
  const customerId = Number(params.get("customerId")) || undefined;
  return <DraftOrderBuilder customerId={customerId} />;
}

export default function NewDraftOrderPage() {
  return (
    <div>
      <BackButton href="/orders/draft-orders" />
      <h1 className="text-2xl font-semibold mb-4">Create order</h1>
      {/* useSearchParams() needs a Suspense boundary for the static build. */}
      <Suspense fallback={null}>
        <NewDraftOrder />
      </Suspense>
    </div>
  );
}
