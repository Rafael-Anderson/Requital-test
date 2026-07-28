"use client";

import BackButton from "@/components/ui/BackButton";
import DraftOrderBuilder from "@/components/DraftOrderBuilder";

export default function NewDraftOrderPage() {
  return (
    <div>
      <BackButton href="/draft-orders" />
      <h1 className="text-2xl font-semibold mb-4">New draft order</h1>
      <DraftOrderBuilder />
    </div>
  );
}
