// Rewritten to by proxy.ts (see that file's own comment) when an incoming
// {subdomain}.requital.io host or connected custom domain doesn't resolve
// to any real shop — a clean page instead of the per-shop layout crashing
// on a null shop, or the request just falling through to a 404 with no
// context.
export default function StoreNotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Store not found</h1>
        <p className="text-zinc-500 mt-2">There&apos;s no Requital store at this address.</p>
      </div>
    </div>
  );
}
