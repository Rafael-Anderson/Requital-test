import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/products",
}));
import { parsePageSize, parsePositiveInt, useUrlPagination } from "./useUrlPagination";

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
});

describe("parsing", () => {
  it("falls back for junk instead of throwing", () => {
    expect(parsePositiveInt("3", 1)).toBe(3);
    for (const bad of [null, "", "0", "-2", "abc", "1.5", "99999999999"]) {
      expect(parsePositiveInt(bad, 1)).toBe(1);
    }
  });
  it("only accepts the offered page sizes", () => {
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("100")).toBe(100);
    expect(parsePageSize("37")).toBe(20);
    expect(parsePageSize(null)).toBe(20);
  });
});

describe("useUrlPagination", () => {
  it("reads page, pageSize and all from the URL", () => {
    nav.search = "page=3&pageSize=50";
    const { result } = renderHook(() => useUrlPagination());
    expect(result.current).toMatchObject({ page: 3, pageSize: 50, all: false });
    nav.search = "all=1";
    expect(renderHook(() => useUrlPagination()).result.current.all).toBe(true);
  });

  it("defaults are page 1, 20 per page, not all", () => {
    const { result } = renderHook(() => useUrlPagination());
    expect(result.current).toMatchObject({ page: 1, pageSize: 20, all: false });
  });

  it("setPage writes ?page= and keeps the other parameters; page 1 is removed", () => {
    nav.search = "collection=7&q=rose";
    const { result } = renderHook(() => useUrlPagination());
    result.current.setPage(4);
    expect(nav.replace).toHaveBeenLastCalledWith("/products?collection=7&q=rose&page=4", { scroll: false });
    result.current.setPage(1);
    expect(nav.replace).toHaveBeenLastCalledWith("/products?collection=7&q=rose", { scroll: false });
  });

  it("changing the page size resets the page", () => {
    nav.search = "page=5";
    const { result } = renderHook(() => useUrlPagination());
    result.current.setPageSize(50);
    expect(nav.replace).toHaveBeenLastCalledWith("/products?pageSize=50", { scroll: false });
    result.current.setPageSize(20);
    expect(nav.replace).toHaveBeenLastCalledWith("/products", { scroll: false });
  });

  it("a filter change resets the page and leaves show-all", () => {
    nav.search = "page=5&all=1&pageSize=50";
    const { result } = renderHook(() => useUrlPagination());
    result.current.resetPage({ collection: "9" });
    expect(nav.replace).toHaveBeenLastCalledWith("/products?pageSize=50&collection=9", { scroll: false });
  });

  it("show all is ?all=1 and clears the page", () => {
    nav.search = "page=2";
    const { result } = renderHook(() => useUrlPagination());
    result.current.setAll(true);
    expect(nav.replace).toHaveBeenLastCalledWith("/products?all=1", { scroll: false });
  });
});
