import type { PostingRow, Verdict } from '../api/types';

/** The provider id the pipeline writes for a posting rejected before the model. */
export const HARD_FILTER_PROVIDER = 'hard-filter';

/** The bottom of the MAYBE band. Mirrors toVerdict() in the backend. */
const MAYBE_FLOOR = 50;
const NEAR_MISS_FLOOR = 40;

export function isHardFiltered(row: PostingRow): boolean {
  return row.providerId === HARD_FILTER_PROVIDER;
}

export function ruleOf(row: PostingRow): string | null {
  if (!isHardFiltered(row)) return null;
  const prefix = `${HARD_FILTER_PROVIDER}:`;
  return row.reasoning.startsWith(prefix) ? row.reasoning.slice(prefix.length) : null;
}

/**
 * Machine rule strings never reach the screen. The three cases are every rule
 * applyHardFilters can currently produce; the fallback exists so a rule added
 * later degrades to a readable sentence instead of leaking `hard-filter:x`.
 */
export function rejectionSentence(rule: string): string {
  switch (rule) {
    case 'location':
      return 'Rejected before scoring: its location matches one of your excluded locations.';
    case 'employment-type':
      return 'Rejected before scoring: its employment type is not one you allow.';
    case 'salary':
      return 'Rejected before scoring: the salary it states is below your minimum.';
    default:
      return `Rejected before scoring by the rule ${rule}.`;
  }
}

export function isNearMiss(row: PostingRow): boolean {
  return row.verdict === 'NO'
    && row.total >= NEAR_MISS_FLOOR
    && row.total < MAYBE_FLOOR;
}

export function nearMissGap(row: PostingRow): number {
  return MAYBE_FLOOR - row.total;
}

export function isStale(row: PostingRow, currentVersion: number | null): boolean {
  if (currentVersion === null) return false;
  return Number(row.settingsVersion) !== currentVersion;
}

export function pipCount(verdict: Verdict): number {
  return verdict === 'STRONG' ? 3 : verdict === 'MAYBE' ? 2 : 1;
}

export function bandKey(verdict: Verdict): 'strong' | 'maybe' | 'no' {
  return verdict === 'STRONG' ? 'strong' : verdict === 'MAYBE' ? 'maybe' : 'no';
}

export function relativeTime(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 5) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface DayGroup {
  /** The UTC calendar date, yyyy-mm-dd. Stable React key. */
  key: string;
  /** Today / Yesterday / N days ago. */
  label: string;
  /** The date spelled out, e.g. "26 August". */
  date: string;
  rows: PostingRow[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * yyyy-mm-dd in UTC. Bucketing on the calendar date, not on elapsed hours, is
 * what makes "Today" mean today rather than "within 24 hours".
 */
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string, now: Date): string {
  const todayKey = utcDateKey(now);
  if (key === todayKey) return 'Today';

  const days = Math.round(
    (Date.parse(`${todayKey}T00:00:00.000Z`) - Date.parse(`${key}T00:00:00.000Z`)) / 86_400_000,
  );
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

function spelledDate(key: string): string {
  const [, month, day] = key.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export function groupByDay(
  rows: PostingRow[], now: Date, descending: boolean,
): DayGroup[] {
  const buckets = new Map<string, PostingRow[]>();
  for (const row of rows) {
    const key = utcDateKey(new Date(row.scoredAt));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({
      key,
      label: dayLabel(key, now),
      date: spelledDate(key),
      rows: [...buckets.get(key)!].sort(
        (a, b) => (descending ? b.total - a.total : a.total - b.total),
      ),
    }));
}
