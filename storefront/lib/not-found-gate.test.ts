import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

const getShop = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getShop: (slug: string) => getShop(slug) };
});

import { HttpError } from "@/lib/api";
import { notFoundIfMissing } from "./not-found-gate";

describe("notFoundIfMissing", () => {
  beforeEach(() => {
    notFound.mockClear();
    getShop.mockReset();
    getShop.mockResolvedValue({ published: true });
  });

  it("throws notFound on a definite 404 for a published shop", async () => {
    await expect(notFoundIfMissing("s", () => Promise.reject(new HttpError("nope", 404)))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does nothing when the thing exists", async () => {
    await notFoundIfMissing("s", () => Promise.resolve({ id: 1 }));
    expect(notFound).not.toHaveBeenCalled();
  });

  it("fails open on a 5xx or a network error", async () => {
    await notFoundIfMissing("s", () => Promise.reject(new HttpError("boom", 500)));
    await notFoundIfMissing("s", () => Promise.reject(new TypeError("fetch failed")));
    expect(notFound).not.toHaveBeenCalled();
  });

  it("skips an unpublished shop (theme-builder preview reads 404 without its token)", async () => {
    getShop.mockResolvedValue({ published: false });
    await notFoundIfMissing("s", () => Promise.reject(new HttpError("nope", 404)));
    expect(notFound).not.toHaveBeenCalled();
  });

  it("leaves an unknown shop to the shop layout when the shop fetch fails", async () => {
    getShop.mockRejectedValue(new HttpError("nope", 404));
    await notFoundIfMissing("s", () => Promise.reject(new HttpError("nope", 404)));
    expect(notFound).not.toHaveBeenCalled();
  });
});
