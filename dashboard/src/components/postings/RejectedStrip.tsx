import { useDashboardData } from '../../context/DashboardData';
import type { PostingRow } from '../../api/types';
import { ruleOf } from '../../postings/derive';
import { LedgerRow } from './LedgerRow';
import s from './RejectedStrip.module.css';

interface Props {
  /** Already narrowed to hard-filtered rows by the page. */
  rows: PostingRow[];
  currentVersion: number | null;
  now: Date;
}

/**
 * Rejected postings stay recorded but out of the daily scan. This is a
 * deliberate departure from the original brief's "keep them visible", made to
 * protect the five-second read — and it reverts by rendering `rows` inline.
 */
export function RejectedStrip({ rows, currentVersion, now }: Props) {
  const { ui, setUi } = useDashboardData();
  if (rows.length === 0) return null;

  const byRule = new Map<string, number>();
  for (const row of rows) {
    const rule = ruleOf(row) ?? 'unknown';
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }

  const breakdown = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, count]) => `${count} ${rule}`)
    .join(', ');

  return (
    <>
      <div className={s.strip}>
        <span>
          {rows.length} {rows.length === 1 ? 'posting' : 'postings'} never
          reached the model — {breakdown}.
        </span>
        <button
          type="button" className={s.toggle}
          aria-expanded={ui.showRejected}
          onClick={() => setUi({ ...ui, showRejected: !ui.showRejected })}
        >
          {ui.showRejected ? 'Hide them' : 'Show them'}
        </button>
      </div>

      {ui.showRejected && (
        <div className={s.rows}>
          {rows.map((row) => (
            <LedgerRow
              key={row.postingId} row={row} currentVersion={currentVersion}
              weights={null} now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
