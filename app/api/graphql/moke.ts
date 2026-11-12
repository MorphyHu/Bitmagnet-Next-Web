import mokeData from "@/moke";

export function search(
  _: unknown,
  {
    queryInput,
  }: {
    queryInput: { offset: number; limit: number; withTotalCount?: boolean };
  },
) {
  const { offset, limit, withTotalCount } = queryInput;
  const result = mokeData.search;
  const remaining = Math.max(0, result.total_count - offset);

  return {
    ...result,
    torrents: result.torrents.slice(0, Math.min(limit, remaining)),
    total_count: withTotalCount ? result.total_count : 0,
    has_more: remaining > limit,
  };
}

export function searchCount() {
  return mokeData.search.total_count;
}

export function torrentByHash() {
  return mokeData.detail;
}

export function statsInfo() {
  return mokeData.stats;
}
