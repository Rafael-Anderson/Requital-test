"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PlatformRootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/platform/shops");
  }, [router]);
  return null;
}
