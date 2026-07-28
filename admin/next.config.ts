import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Categories moved from its own top-level page into a tab under
  // Inventory — kept as a real redirect (not a client-side stub page) so
  // any bookmarked/shared /categories link still lands correctly.
  async redirects() {
    return [{ source: "/categories", destination: "/inventory/categories", permanent: true }];
  },
};

export default nextConfig;
