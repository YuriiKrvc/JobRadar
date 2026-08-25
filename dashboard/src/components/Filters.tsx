import type { PostingFilters, PostingRow, Verdict } from '../api/types';

const VERDICTS: Verdict[] = ['STRONG', 'MAYBE', 'NO'];

export function Filters({
  value, onChange, rows,
}: {
  value: PostingFilters;
  onChange: (next: PostingFilters) => void;
  rows: PostingRow[];
}) {
  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const providers = [...new Set(rows.map((r) => r.providerId))].sort();

  return (
    <div className="filters">
      <label>
        Verdict{' '}
        <select
          value={value.verdict ?? ''}
          onChange={(e) => onChange({ ...value, verdict: e.target.value as Verdict | '' })}
        >
          <option value="">any</option>
          {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>

      <label>
        Source{' '}
        <select
          value={value.source ?? ''}
          onChange={(e) => onChange({ ...value, source: e.target.value })}
        >
          <option value="">any</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label>
        Provider{' '}
        <select
          value={value.provider ?? ''}
          onChange={(e) => onChange({ ...value, provider: e.target.value })}
        >
          <option value="">any</option>
          {providers.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>

      <label>
        Min score{' '}
        <input
          type="number" min={0} max={100} value={value.minTotal ?? 0}
          onChange={(e) => onChange({ ...value, minTotal: Number(e.target.value) })}
        />
      </label>

      <label>
        Scored since{' '}
        <input
          type="date" value={value.since ?? ''}
          onChange={(e) => onChange({ ...value, since: e.target.value })}
        />
      </label>
    </div>
  );
}
