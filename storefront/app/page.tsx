// Every real page lives under /<shopSlug>/... (see app/[shop]/) — the bare
// root has no shop context to resolve. Path-prefix tenant resolution was
// chosen for dev simplicity over subdomain routing (see the Phase 1 task
// notes); a merchant's own domain can map to their /<slug> path later
// without changing this contract.
export default function RootPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Requital Storefront</h1>
        <p className="text-zinc-500 mt-2">Visit /&lt;your-shop-slug&gt; to browse a shop.</p>
      </div>
    </div>
  );
}
