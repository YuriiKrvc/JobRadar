import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostingRow, RubricWeights } from '../../api/types';
import {
  bandKey, isHardFiltered, isNearMiss, isStale, nearMissGap,
  pipCount, rejectionSentence, relativeTime, ruleOf,
} from '../../postings/derive';
import { ScoreBreakdown } from './ScoreBreakdown';
import s from './LedgerRow.module.css';

interface Props {
  row: PostingRow;
  currentVersion: number | null;
  /** Null for a rejected row: there is no breakdown to weight. */
  weights: RubricWeights | null;
  now: Date;
}

export function LedgerRow({ row, currentVersion, weights, now }: Props) {
  const [expanded, setExpanded] = useState(false);

  const band = bandKey(row.verdict);
  const filtered = isHardFiltered(row);
  const rule = ruleOf(row);
  const near = isNearMiss(row);
  const stale = isStale(row, currentVersion);
  const pips = pipCount(row.verdict);

  return (
    <article className={near ? `${s.row} ${s.nearMissRow}` : s.row}>
      <div className={`${s.score} ${s[band]}`}>{row.total}</div>

      <div className={s.verdictCell}>
        <div className={s.verdictWord}>{row.verdict}</div>
        <div className={s.pips} role="img" aria-label={`Verdict ${row.verdict}, ${pips} of 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= pips ? `${s.pip} ${s.pipOn}` : s.pip} />
          ))}
        </div>

        {near && (
          <div className={`${s.tag} ${s.tagNear}`}>
            Near miss · {nearMissGap(row)} under
          </div>
        )}
        {stale && (
          <div
            className={`${s.tag} ${s.tagStale}`}
            role="img"
            aria-label={`Stale score, computed under settings version ${row.settingsVersion}`}
          >
            ⚠ v{row.settingsVersion}
          </div>
        )}
        {filtered && rule && (
          <div className={`${s.tag} ${s.tagFiltered}`}>Filtered · {rule}</div>
        )}
      </div>

      <div className={s.roleCell}>
        <a className={s.title} href={row.url} target="_blank" rel="noreferrer">{row.title}</a>
        <div className={s.company}>
          {row.company} · {row.location ?? 'Location not stated'}
        </div>
      </div>

      <div className={s.sourceCell}>{row.source}</div>

      <div className={s.whyCell}>
        {/* Machine strings never surface: a rejected row reads as a sentence. */}
        <div className={filtered ? `${s.why} ${s.whyMuted}` : s.why}>
          {filtered && rule ? rejectionSentence(rule) : row.reasoning}
        </div>

        {!filtered && weights && (
          <button
            type="button" className={s.toggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? 'Hide breakdown' : 'Breakdown'}
          </button>
        )}

        {filtered && (
          <div>
            <Link to="/settings" className={s.toggle}>Edit the rule that rejected this</Link>
          </div>
        )}

        {expanded && weights && (
          <ScoreBreakdown subscores={row.subscores} weights={weights} stale={stale} />
        )}
      </div>

      <div className={s.whenCell}>{relativeTime(row.scoredAt, now)}</div>
    </article>
  );
}
