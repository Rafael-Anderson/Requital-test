// Full-viewport placeholder shown while the shop itself (ShopProvider's own
// getShop()/listOutlets() fetch, see lib/shop-context.tsx) is still
// resolving — not a per-widget spinner for a page's own secondary fetch.
// Deliberately no chrome (Header/Footer aren't mounted yet at this point on
// every page that uses it) and no text/spinner, just the pulse blocks.
export default function StorefrontLoadingSkeleton() {
  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center gap-6 p-6">
      <div className="h-10 w-[200px] rounded-lg bg-gray-200 animate-pulse" />
      <div className="flex gap-4">
        <div className="h-[180px] w-40 rounded-lg bg-gray-200 animate-pulse" />
        <div className="h-[180px] w-40 rounded-lg bg-gray-200 animate-pulse" />
        <div className="h-[180px] w-40 rounded-lg bg-gray-200 animate-pulse" />
      </div>
    </div>
  );
}
