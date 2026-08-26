import { useEffect, useState } from 'react';
import { useDashboardData } from '../../context/DashboardData';
import type { SinceWindow } from '../../api/filters-url';
import type { PostingRow, Verdict } from '../../api/types';
import s from './Filters.module.css';

const VERDICT_OPTIONS: Array<{ value: Verdict | 'any'; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'STRONG', label: 'Strong' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NO', label: 'No' },
];

const SINCE_OPTIONS: Array<{ value: SinceWindow; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export function Filters({ rows, resultCount }: { rows: PostingRow[]; resultCount: number }) {
  const { ui, setUi } = useDashboardData();

  // The slider commits on release, not on every input event: a range input
  // fires per pixel of drag, and each commit would push a history entry.
  const [draftScore, setDraftScore] = useState(ui.minTotal);
  useEffect(() => { setDraftScore(ui.minTotal); }, [ui.minTotal]);

  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const providers = [...new Set(rows.map((r) => r.providerId))].sort();

  return (
    <>
      <div className={s.bar}>
        <div className={s.group}>
          <div className={s.label}>Verdict</div>
          <div className={s.segmented}>
            {VERDICT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={ui.verdict === o.value}
                className={ui.verdict === o.value ? `${s.segment} ${s.segmentOn}` : s.segment}
                onClick={() => setUi({ ...ui, verdict: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-source">Source</label>
          <select
            id="filter-source" className={s.select} value={ui.source}
            onChange={(e) => setUi({ ...ui, source: e.target.value })}
          >
            <option value="any">Any source</option>
            {sources.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-provider">Provider</label>
          <select
            id="filter-provider" className={s.select} value={ui.provider}
            onChange={(e) => setUi({ ...ui, provider: e.target.value })}
          >
            <option value="any">Any provider</option>
            {providers.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-score">Min score {draftScore}</label>
          <input
            id="filter-score" className={s.slider} type="range"
            min={0} max={100} step={5} value={draftScore}
            aria-label="Minimum score"
            onChange={(e) => setDraftScore(Number(e.target.value))}
            onBlur={() => setUi({ ...ui, minTotal: draftScore })}
            onPointerUp={() => setUi({ ...ui, minTotal: draftScore })}
            onKeyUp={() => setUi({ ...ui, minTotal: draftScore })}
          />
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-since">Scored since</label>
          <select
            id="filter-since" className={s.select} value={ui.since}
            onChange={(e) => setUi({ ...ui, since: e.target.value as SinceWindow })}
          >
            {SINCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className={s.tail}>
          <div className={s.count}>{resultCount} postings</div>
          <button
            type="button" className={s.sort}
            aria-sort={ui.sort === 'desc' ? 'descending' : 'ascending'}
            onClick={() => setUi({ ...ui, sort: ui.sort === 'desc' ? 'asc' : 'desc' })}
          >
            Score {ui.sort === 'desc' ? '▼' : '▲'}
          </button>
        </div>
      </div>

      <div className={s.rule} />
    </>
  );
}
