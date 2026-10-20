// Named ladder seasons. The id is the server SEASON value (2026-1, 2026-2, …).
// Each season runs eight weeks from the previous start.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const SEASONS = [
  { id: '2026-1', name: 'Two Words: Move In', starts: '2026-10-19' },
  { id: '2026-2', name: 'Sporefall', starts: '2026-12-14' },
  { id: '2027-1', name: 'High Canopy', starts: '2027-02-08' },
  { id: '2027-2', name: 'Long Dusk', starts: '2027-04-05' },
  { id: '2027-3', name: 'Emberwell', starts: '2027-05-31' },
  { id: '2027-4', name: 'Frostgarden', starts: '2027-07-26' },
];

/** @param {string} iso YYYY-MM-DD */
export function formatSeasonStart(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return `Started ${month} ${Number(match[3])}, ${match[1]}`;
}

/** @param {string} [id] */
export function seasonInfo(id) {
  const index = SEASONS.findIndex((season) => season.id === id);
  if (index < 0) return { name: id ? String(id) : '', started: '', number: null };
  const row = SEASONS[index];
  return { name: row.name, started: formatSeasonStart(row.starts), number: index };
}
