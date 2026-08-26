import type { RubricWeights, SubScores } from '../../api/types';
import s from './ScoreBreakdown.module.css';

const DIMENSIONS: Array<{ key: keyof SubScores; label: string }> = [
  { key: 'coreStack', label: 'Core stack' },
  { key: 'seniority', label: 'Seniority' },
  { key: 'domain', label: 'Domain' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'growth', label: 'Growth' },
];

interface Props {
  subscores: SubScores;
  weights: RubricWeights;
  stale: boolean;
}

export function ScoreBreakdown({ subscores, weights, stale }: Props) {
  // Weights are normalised by their actual sum, never by 100 — the backend
  // does the same, so a rubric of 70/40/30/40/20 shows the same shares as
  // 35/20/15/20/10.
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);

  const spoken = DIMENSIONS
    .map((d) => `${d.label.toLowerCase()} ${subscores[d.key].score}`)
    .join(', ');

  return (
    <div
      className={stale ? `${s.panel} ${s.stale}` : s.panel}
      role="img"
      aria-label={`Sub-scores out of 100: ${spoken}.`}
    >
      {DIMENSIONS.map((d) => {
        const value = subscores[d.key].score;
        return (
          <div className={s.dim} key={d.key}>
            <div className={s.dimLabel}>{d.label}</div>
            <div className={s.track}>
              {/* Dimensions share the 0-100 scale of `total`, so the score is
                  the percentage directly. */}
              <div className={s.fill} style={{ width: `${value}%` }} />
            </div>
            <div className={s.value}>{value}</div>
            <div className={s.share}>{Math.round((weights[d.key] / sum) * 100)}%</div>
            <div className={s.note}>{subscores[d.key].note}</div>
          </div>
        );
      })}
    </div>
  );
}
