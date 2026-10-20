// What the ladder dialog shows: the top 10, the ranks around you, and one page.

export const TOP_N = 10;
export const NEIGHBOR = 3;
export const PAGE_SIZE = 10;

export function ladderSlices(rows, playerId, page = 0) {
  const list = Array.isArray(rows) ? rows : [];
  const meIndex = list.findIndex((row) => row.playerId === playerId);
  const me = meIndex >= 0 ? list[meIndex] : null;
  const top = list.slice(0, TOP_N);
  let around = [];
  if (meIndex >= TOP_N) {
    const start = Math.max(TOP_N, meIndex - NEIGHBOR);
    const end = Math.min(list.length, meIndex + NEIGHBOR + 1);
    around = list.slice(start, end);
  }
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safe = Math.min(pages - 1, Math.max(0, page | 0));
  return {
    top,
    around,
    pageRows: list.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE),
    page: safe,
    pages,
    me,
  };
}
