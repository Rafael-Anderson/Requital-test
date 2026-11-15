import { describe, expect, it, vi } from "vitest";
import { loadAllPages } from "./load-all-pages";

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const server = (total: number, chunk: number) =>
  vi.fn(async (page: number) => ({
    data: rows((page - 1) * chunk + 1, Math.max(0, Math.min(chunk, total - (page - 1) * chunk))),
    total,
  }));

describe("loadAllPages", () => {
  it("fetches every page until the end", async () => {
    const f = server(250, 100);
    const r = await loadAllPages(f, { chunk: 100, max: 2000, isStale: () => false });
    expect(r!.items).toHaveLength(250);
    expect(r).toMatchObject({ total: 250, capped: false });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("stops at the ceiling and reports that it was capped", async () => {
    const f = server(2500, 100);
    const r = await loadAllPages(f, { chunk: 100, max: 2000, isStale: () => false });
    expect(r!.items).toHaveLength(2000);
    expect(r).toMatchObject({ total: 2500, capped: true });
    expect(f).toHaveBeenCalledTimes(20);
  });

  it("an exact multiple of the chunk does not ask for an extra empty page", async () => {
    const f = server(200, 100);
    const r = await loadAllPages(f, { chunk: 100, max: 2000, isStale: () => false });
    expect(r!.items).toHaveLength(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("an empty list is one request", async () => {
    const f = server(0, 100);
    const r = await loadAllPages(f, { chunk: 100, max: 2000, isStale: () => false });
    expect(r).toMatchObject({ items: [], total: 0, capped: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("stops quietly (null) the moment the request is stale", async () => {
    let stale = false;
    const f = vi.fn(async (page: number) => {
      if (page === 2) stale = true;
      return { data: rows((page - 1) * 100 + 1, 100), total: 1000 };
    });
    const r = await loadAllPages(f, { chunk: 100, max: 2000, isStale: () => stale });
    expect(r).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("reports progress, never above the ceiling", async () => {
    const seen: [number, number][] = [];
    await loadAllPages(server(250, 100), {
      chunk: 100,
      max: 200,
      isStale: () => false,
      onProgress: (l, t) => seen.push([l, t]),
    });
    expect(seen).toEqual([
      [100, 200],
      [200, 200],
    ]);
  });

  it("a failing page rejects instead of hanging", async () => {
    const f = vi.fn().mockResolvedValueOnce({ data: rows(1, 100), total: 300 }).mockRejectedValueOnce(new Error("boom"));
    await expect(loadAllPages(f, { chunk: 100, max: 2000, isStale: () => false })).rejects.toThrow("boom");
  });

  it("a server that never runs dry cannot loop past the ceiling", async () => {
    const f = vi.fn(async (page: number) => ({ data: rows((page - 1) * 100 + 1, 100), total: 99999 }));
    const r = await loadAllPages(f, { chunk: 100, max: 300, isStale: () => false });
    expect(r!.items).toHaveLength(300);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
