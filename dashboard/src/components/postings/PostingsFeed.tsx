import type { PostingRow, RubricWeights } from '../../api/types';
import { groupByDay, isHardFiltered } from '../../postings/derive';
import { LedgerRow } from './LedgerRow';
import s from './PostingsFeed.module.css';

interface Props {
  rows: PostingRow[];
  currentVersion: number | null;
  weights: RubricWeights | null;
  now: Date;
  descending: boolean;
}

export function PostingsFeed({ rows, currentVersion, weights, now, descending }: Props) {
  // Rejected postings are recorded, not dropped — they are rendered by
  // RejectedStrip behind a count, so they never crowd the daily scan.
  const scored = rows.filter((r) => !isHardFiltered(r));
  const groups = groupByDay(scored, now, descending);

  return (
    <>
      <div className={s.head}>
        <div className={s.hScore}>Score</div>
        <div className={s.hVerdict}>Verdict</div>
        <div className={s.hRole}>Role / company</div>
        <div className={s.hSource}>Source</div>
        <div className={s.hWhy}>Why</div>
        <div className={s.hWhen}>Scored</div>
      </div>

      {groups.map((g) => (
        <section key={g.key}>
          <div className={s.divider}>
            <div className={s.dividerLabel}>{g.label}</div>
            <div className={s.dividerSub}>{g.date} · {g.rows.length} new</div>
            <div className={s.dividerRule} />
          </div>

          {g.rows.map((row) => (
            <LedgerRow
              key={row.postingId} row={row} currentVersion={currentVersion}
              weights={weights} now={now}
            />
          ))}
        </section>
      ))}
    </>
  );
}
