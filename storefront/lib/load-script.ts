// Generic version of google-maps-loader.ts's own single-script pattern,
// keyed by src so multiple independent third-party scripts (Tabby/Tamara's
// installment-promo widgets, etc.) can each be loaded exactly once without
// colliding with each other's cache.
const loaderPromises = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Scripts can only load in the browser"));
  const cached = loaderPromises.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loaderPromises.delete(src);
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(script);
  });
  loaderPromises.set(src, promise);
  return promise;
}
