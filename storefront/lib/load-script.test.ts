import { afterEach, describe, expect, it, vi } from "vitest";

// A fresh module instance per test so the internal `cache` Map doesn't
// leak state between tests (the module has no reset hook of its own).
async function freshLoadScriptOnce() {
  vi.resetModules();
  const mod = await import("./load-script");
  return mod.loadScriptOnce;
}

afterEach(() => {
  document.head.innerHTML = "";
});

describe("loadScriptOnce", () => {
  it("appends exactly one <script> tag for a given src, even across concurrent calls", async () => {
    const loadScriptOnce = await freshLoadScriptOnce();
    const src = "https://example.test/a.js";

    const first = loadScriptOnce(src);
    const second = loadScriptOnce(src);
    expect(first).toBe(second);
    expect(document.querySelectorAll(`script[src="${src}"]`)).toHaveLength(1);

    document.querySelector(`script[src="${src}"]`)!.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBeUndefined();
  });

  it("loads different src values independently", async () => {
    const loadScriptOnce = await freshLoadScriptOnce();
    loadScriptOnce("https://example.test/a.js");
    loadScriptOnce("https://example.test/b.js");

    expect(document.querySelectorAll("script")).toHaveLength(2);
  });

  it("rejects and removes the cache entry when the script fails to load, so a later call retries", async () => {
    const loadScriptOnce = await freshLoadScriptOnce();
    const src = "https://example.test/fails.js";

    const first = loadScriptOnce(src);
    document.querySelector(`script[src="${src}"]`)!.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow();

    loadScriptOnce(src);
    expect(document.querySelectorAll(`script[src="${src}"]`)).toHaveLength(2);
  });
});
