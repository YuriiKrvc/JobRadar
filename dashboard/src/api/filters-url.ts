import type { PostingFilters, Verdict } from './types';

export type SinceWindow = 'any' | '24h' | '7d' | '30d';

const VERDICTS: Verdict[] = ['STRONG', 'MAYBE', 'NO'];
const WINDOWS: SinceWindow[] = ['any', '24h', '7d', '30d'];
const WINDOW_DAYS: Record<Exclude<SinceWindow, 'any'>, number> = {
  '24h': 1, '7d': 7, '30d': 30,
};

export interface UiFilters {
  verdict: Verdict | 'any';
  source: string;
  provider: string;
  minTotal: number;
  since: SinceWindow;
  /** UI only — the API always sorts by total descending. */
  sort: 'asc' | 'desc';
  /** UI only — rejected rows are split out client-side. */
  showRejected: boolean;
}

export const DEFAULT_FILTERS: UiFilters = {
  verdict: 'any', source: 'any', provider: 'any',
  minTotal: 0, since: 'any', sort: 'desc', showRejected: false,
};

/**
 * A hand-edited or stale URL degrades to defaults rather than erroring. The
 * backend's PostingFiltersSchema remains the real validator; this only has to
 * avoid putting nonsense on screen.
 */
export function parseFilters(params: URLSearchParams): UiFilters {
  const verdict = params.get('verdict');
  const since = params.get('since');
  const minTotal = Number(params.get('minTotal'));

  return {
    verdict: VERDICTS.includes(verdict as Verdict) ? verdict as Verdict : 'any',
    source: params.get('source') || 'any',
    provider: params.get('provider') || 'any',
    minTotal: Number.isFinite(minTotal) ? Math.min(100, Math.max(0, Math.trunc(minTotal))) : 0,
    since: WINDOWS.includes(since as SinceWindow) ? since as SinceWindow : 'any',
    sort: params.get('sort') === 'asc' ? 'asc' : 'desc',
    showRejected: params.get('rejected') === '1',
  };
}

/** Defaults are omitted, so the resting URL is a bare `/`. */
export function toSearchParams(ui: UiFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (ui.verdict !== 'any') params.set('verdict', ui.verdict);
  if (ui.source !== 'any') params.set('source', ui.source);
  if (ui.provider !== 'any') params.set('provider', ui.provider);
  if (ui.minTotal !== 0) params.set('minTotal', String(ui.minTotal));
  if (ui.since !== 'any') params.set('since', ui.since);
  if (ui.sort !== 'desc') params.set('sort', ui.sort);
  if (ui.showRejected) params.set('rejected', '1');
  return params;
}

/**
 * The URL carries the window token, not a date, so a bookmark stays relative.
 * The date is computed at request time instead.
 */
export function toApiFilters(ui: UiFilters, now: Date): PostingFilters {
  const filters: PostingFilters = { limit: 500 };
  if (ui.verdict !== 'any') filters.verdict = ui.verdict;
  if (ui.source !== 'any') filters.source = ui.source;
  if (ui.provider !== 'any') filters.provider = ui.provider;
  if (ui.minTotal !== 0) filters.minTotal = ui.minTotal;
  if (ui.since !== 'any') {
    const days = WINDOW_DAYS[ui.since];
    filters.since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  }
  return filters;
}
