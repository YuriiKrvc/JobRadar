import { useMemo, useState } from 'react';
import type { PostingRow } from '../api/types';
import { VerdictBadge } from './VerdictBadge';

export function isNearMiss(row: PostingRow): boolean {
  return row.verdict === 'NO' && row.total >= 40 && row.total < 50;
}

export function PostingsTable({ rows }: { rows: PostingRow[] }) {
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (descending ? b.total - a.total : a.total - b.total)),
    [rows, descending],
  );

  if (rows.length === 0) {
    return <p className="state">No postings scored yet.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th onClick={() => setDescending((d) => !d)} aria-sort={descending ? 'descending' : 'ascending'}>
            Score {descending ? '▼' : '▲'}
          </th>
          <th>Verdict</th>
          <th>Title</th>
          <th>Company</th>
          <th>Source</th>
          <th>Location</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.postingId} className={isNearMiss(r) ? 'row-near-miss' : `row-${r.verdict}`}>
            <td className="total">{r.total}</td>
            <td><VerdictBadge verdict={r.verdict} /></td>
            <td><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td>
            <td>{r.company}</td>
            <td>{r.source}</td>
            <td>{r.location ?? '—'}</td>
            <td>{r.reasoning}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
