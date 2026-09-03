// Full-viewport placeholder shown while the shop itself (ShopProvider's own
// getShop()/listOutlets() fetch, see lib/shop-context.tsx) is still
// resolving — not a per-widget spinner for a page's own secondary fetch.
// Deliberately no chrome (Header/Footer aren't mounted yet at this point on
// every page that uses it, and ShopLayoutClient's Body renders ONLY this
// while loading — no TopBar/MenuBar).
//
// Fully neutral: no shop name/slug text, no logo, no iconography — just grey
// blocks. The only theme-awareness is the canvas color: it reads
// --background / --color-header-fg, which app/[shop]/layout.tsx emits
// server-side in a pre-paint <style>, so a dark-branded shop doesn't flash a
// white screen. Everything identifiable about the merchant waits until the
// real theme has loaded.
export default function StorefrontLoadingSkeleton() {
  const blockStyle = { background: "color-mix(in srgb, var(--color-header-fg, #171717) 12%, transparent)" };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6"
      style={{ background: "var(--background, #ffffff)" }}
    >
      <div className="h-10 w-[200px] rounded-lg animate-pulse" style={blockStyle} />
      <div className="flex gap-4">
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
      </div>
    </div>
  );
}
