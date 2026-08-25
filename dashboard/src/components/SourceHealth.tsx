import type { HealthRow } from '../api/types';

export function SourceHealth({ rows }: { rows: HealthRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="health">
      <h2>Source health</h2>
      <ul>
        {rows.map((r, i) => (
          <li key={`${r.source}-${r.ranAt}-${i}`} className={r.status === 'error' ? 'error' : undefined}>
            {r.source} — {r.status}{r.error ? `: ${r.error}` : ''}{' '}
            <time dateTime={r.ranAt}>{new Date(r.ranAt).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
