import Toggle from "@/components/ui/Toggle";

// App embeds mode's right panel — Shopify's real editor lists installed
// apps that inject storefront embeds (a review widget's floating button,
// etc.). No app-extensibility model exists in this codebase, so this is a
// deliberate, explicit descope: two disabled placeholder toggles rather
// than a fabricated app list, matching the mode switcher's third icon so
// the mode isn't a dead click.
const PLACEHOLDER_EMBEDS = ["Sample app embed", "Another app embed"];

export default function AppEmbedsPanel() {
  return (
    <div className="p-4">
      <h2 className="mb-1 text-sm font-semibold">App embeds</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Coming soon — this shop has no installed apps that add storefront embeds yet.
      </p>
      <div className="space-y-3">
        {PLACEHOLDER_EMBEDS.map((label) => (
          <div key={label} className="flex items-center justify-between opacity-50">
            <span className="text-sm font-medium">{label}</span>
            <Toggle checked={false} onChange={() => {}} disabled />
          </div>
        ))}
      </div>
    </div>
  );
}
