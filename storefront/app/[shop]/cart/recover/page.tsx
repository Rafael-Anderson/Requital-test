"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { recoverAbandonedCart } from "@/lib/api";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// Destination for the abandoned-cart recovery email's link. There's no
// server-side "resumable checkout session" in this architecture (carts are
// purely client-side until a real Order exists — see
// AbandonedCartsService's own comment on why) — so recovery means
// repopulating the shopper's local cart from the saved snapshot and
// dropping them at /cart to continue, not resuming a checkout form
// mid-fill. Falls back to the shop's first outlet if the abandoned cart
// didn't have one recorded (a customer who bailed before reaching the
// outlet-dependent part of checkout).
function RecoverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { outlets, loading: shopLoading } = useShop();
  const { addItem } = useCart();
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    if (shopLoading) return;
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      return;
    }
    recoverAbandonedCart(token)
      .then(({ cartItems, outletId }) => {
        const resolvedOutletId = outletId ?? outlets[0]?.id;
        if (!resolvedOutletId || cartItems.length === 0) {
          setStatus("error");
          return;
        }
        for (const item of cartItems) {
          addItem(
            {
              productId: item.productId,
              variantId: item.variantId,
              variantLabel: item.variantLabel,
              name: item.name,
              price: item.price,
              thumbnail: item.thumbnail,
              maxStock: null,
            },
            item.quantity,
            resolvedOutletId,
          );
        }
        router.replace("/cart");
      })
      .catch(() => setStatus("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopLoading, outlets]);

  if (status === "error") {
    return (
      <StorefrontPageShell variant="narrow">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">This link has expired</h1>
          <p className="text-sm text-zinc-500 mb-4">
            That cart has already been checked out, or this recovery link is no longer valid.
          </p>
          <Link href="/" className="text-accent hover:underline">
            Continue shopping
          </Link>
        </div>
      </StorefrontPageShell>
    );
  }

  return <p className="text-zinc-500">Restoring your cart…</p>;
}

export default function CartRecoverPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <RecoverContent />
    </Suspense>
  );
}
