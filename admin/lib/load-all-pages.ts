// "Show all" for a paginated list: fetches page after page (the server caps a page
// at 100) and stops at a ceiling, so a very large list can neither hang the tab nor
// run an unbounded number of requests. Reports progress and stops quietly as soon
// as the caller says the request is stale (the user changed the view meanwhile).
export interface LoadAllResult<T> {
  items: T[];
  // What the server says exists (can be more than items.length when capped).
  total: number;
  capped: boolean;
}

export async function loadAllPages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; total: number }>,
  opts: {
    chunk: number;
    max: number;
    isStale: () => boolean;
    onProgress?: (loaded: number, total: number) => void;
  },
): Promise<LoadAllResult<T> | null> {
  const acc: T[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await fetchPage(page);
    if (opts.isStale()) return null;
    total = res.total;
    acc.push(...res.data);
    const target = Math.min(total, opts.max);
    opts.onProgress?.(Math.min(acc.length, opts.max), target);
    // A short page is the end; so is having what we came for. (Also a hard stop
    // on an empty page, so a server that keeps answering "more" cannot loop us.)
    if (res.data.length < opts.chunk || acc.length >= target) break;
  }
  return { items: acc.slice(0, opts.max), total, capped: total > opts.max };
}
