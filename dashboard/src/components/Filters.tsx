import { useDashboardData } from '../context/DashboardData';
import type { SinceWindow } from '../api/filters-url';
import type { PostingRow, Verdict } from '../api/types';

const VERDICTS: Verdict[] = ['STRONG', 'MAYBE', 'NO'];

const SINCE_OPTIONS: Array<{ value: SinceWindow; label: string }> = [
  { value: 'any', label: 'any time' },
  { value: '24h', label: 'last 24 hours' },
  { value: '7d', label: 'last 7 days' },
  { value: '30d', label: 'last 30 days' },
];

/**
 * Interim shape: the same five controls as before, reading and writing the URL
 * through the dashboard context instead of local state. Replaced wholesale by
 * components/postings/Filters.tsx.
 */
export function Filters({ rows }: { rows: PostingRow[] }) {
  const { ui, setUi } = useDashboardData();

  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const providers = [...new Set(rows.map((r) => r.providerId))].sort();

  return (
    <div className="filters">
      <label>
        Verdict{' '}
        <select
          value={ui.verdict}
          onChange={(e) => setUi({ ...ui, verdict: e.target.value as Verdict | 'any' })}
        >
          <option value="any">any</option>
          {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>

      <label>
        Source{' '}
        <select value={ui.source} onChange={(e) => setUi({ ...ui, source: e.target.value })}>
          <option value="any">any</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label>
        Provider{' '}
        <select value={ui.provider} onChange={(e) => setUi({ ...ui, provider: e.target.value })}>
          <option value="any">any</option>
          {providers.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>

      <label>
        Min score{' '}
        <input
          type="number" min={0} max={100} value={ui.minTotal}
          onChange={(e) => setUi({ ...ui, minTotal: Number(e.target.value) })}
        />
      </label>

      <label>
        Scored since{' '}
        <select
          value={ui.since}
          onChange={(e) => setUi({ ...ui, since: e.target.value as SinceWindow })}
        >
          {SINCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}
