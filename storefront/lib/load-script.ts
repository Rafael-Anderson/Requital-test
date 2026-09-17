// Generic "load this <script> exactly once" helper, client-side only —
// same reasoning as lib/google-maps-loader.ts's single-purpose loader, just
// keyed by src so more than one external script (Tabby's tabby-promo.js,
// Tamara's tamara-widget.js) can share one cache instead of each needing
// its own copy of this logic.
const cache = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("loadScriptOnce can only run in the browser"));

  const cached = cache.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      cache.delete(src);
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(script);
  });
  cache.set(src, promise);
  return promise;
}
